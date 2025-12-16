const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 文件上传配置 - 支持更多格式
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // 解码文件名（处理中文文件名）
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc (旧格式)
      'text/plain', // .txt
      'text/markdown', // .md
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.docx', '.doc', '.txt', '.md'];
    
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，请上传 .docx, .txt 或 .md 文件`));
    }
  }
});

// 错误处理中间件
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大50MB）' });
    }
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// OpenAI客户端
let openai = null;

function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    });
  }
  return openai;
}

// Cosmic拆分系统提示词
const COSMIC_SYSTEM_PROMPT = `你是一个Cosmic拆分专家。你的任务是将功能过程按照COSMIC规则拆分，并输出真实、具体、可落地的功能过程，功能过程的组成要是动词+名词。

## 四种数据移动类型
- E (Entry): 输入，触发请求
- R (Read): 读取数据库
- W (Write): 写入数据库
- X (eXit): 输出结果

## 核心规则（必须严格遵守）
1. **每个功能过程必须拆分为3-5个子过程**，不能只有1个
2. **顺序必须是：E → R/W → X**（E开头，X结尾，中间至少有1个R或W）
3. **每个功能过程至少包含4行**：1个E + 1-2个R + 0-1个W + 1个X
4. 功能过程名称必须包含业务目标 + 业务对象（例如"调度告警复核并派单"）
5. **禁止只输出E类型**，必须完整输出E→R→W→X的完整流程

## 数据组和数据属性要求
- 每个子过程必须填写数据组和数据属性
- 数据组命名需结合当前功能/子过程，可使用“功能过程·子过程数据”“功能过程（读取）信息集”这类描述，禁止出现连字符 "-"
- 数据属性至少3个字段，可对原始字段做轻度抽象（如“告警ID、告警时间、告警级别”），同一功能过程中不允许与其他子过程完全相同
- 可以根据业务语义推导字段，但必须保持可读、可信；若需要区分，可在末尾添加“（查询段）”“（写入段）”等中文括号描述，不得使用纯数字或 "-1" 形式
- 如果存在潜在重复，必须根据子过程描述提炼2-3个中文关键词写入数据组/数据属性，例如“查询设备健康·条件字段”“分析覆盖率（诊断段）”，而不是简单地添加序号

## 表格列顺序（严格按此顺序）
功能用户 | 触发事件 | 功能过程 | 子过程描述 | 数据移动类型 | 数据组 | 数据属性

## 输出格式示例

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|调度故障单并复核|提交复核请求|E|故障复核-触发参数|工单编号、复核级别、触发时间|
||||读取候选工单|R|故障复核-待审工单表|工单ID、受理侧、紧急度、建单时间|
||||写入复核结果|W|故障复核-结果表|工单ID、复核人、复核结论、处理建议|
||||返回复核结果|X|故障复核-反馈数据|工单ID、复核状态、派单结论、反馈时间|

## 功能用户填写
- 用户触发：发起者：用户 接收者：用户
- 时钟触发：发起者：定时触发器 接收者：网优平台
- 接口触发：发起者：其他平台 接收者：网优平台

请尽可能多地识别文档中的功能过程并拆分，确保命名具体且数据组/数据属性不重复，数据属性要三个以上，并且确保不重复！！同一功能过程内的数据组可通过拼接“功能过程名称+子过程动作”进行具体分析来保持唯一性。`;

// API路由

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasApiKey: !!process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  });
});

// 更新API配置
app.post('/api/config', (req, res) => {
  const { apiKey, baseUrl } = req.body;
  
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey;
  }
  if (baseUrl) {
    process.env.OPENAI_BASE_URL = baseUrl;
  }
  
  // 重置客户端以使用新配置
  openai = null;
  
  res.json({ success: true, message: 'API配置已更新' });
});

// 解析文档（支持多种格式）
app.post('/api/parse-word', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';
    let html = '';

    console.log(`解析文件: ${req.file.originalname}, 类型: ${req.file.mimetype}, 大小: ${req.file.size} bytes`);

    if (ext === '.docx') {
      // 解析 .docx 文件
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value;
        
        const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
        html = htmlResult.value;
        
        if (result.messages && result.messages.length > 0) {
          console.log('Mammoth警告:', result.messages);
        }
      } catch (mammothError) {
        console.error('Mammoth解析错误:', mammothError);
        return res.status(400).json({ 
          error: `Word文档解析失败: ${mammothError.message}。请确保文件是有效的.docx格式（不支持旧版.doc格式）` 
        });
      }
    } else if (ext === '.txt' || ext === '.md') {
      // 解析纯文本或Markdown文件
      text = req.file.buffer.toString('utf-8');
      html = `<pre>${text}</pre>`;
    } else if (ext === '.doc') {
      return res.status(400).json({ 
        error: '不支持旧版.doc格式，请将文件另存为.docx格式后重新上传' 
      });
    } else {
      return res.status(400).json({ error: `不支持的文件格式: ${ext}` });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '文档内容为空，请检查文件是否正确' });
    }

    res.json({ 
      success: true, 
      text: text,
      html: html,
      filename: req.file.originalname,
      fileSize: req.file.size,
      wordCount: text.length
    });
  } catch (error) {
    console.error('解析文档失败:', error);
    res.status(500).json({ error: '解析文档失败: ' + error.message });
  }
});

// AI对话 - Cosmic拆分
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, documentContent } = req.body;
    
    const client = getOpenAIClient();
    if (!client) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    // 构建消息
    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    const chatMessages = [systemMessage];
    
    // 如果有文档内容，添加到上下文
    if (documentContent) {
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分。`
      });
    }

    // 添加用户消息历史
    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 8000
    });

    const reply = completion.choices[0].message.content;

    res.json({ 
      success: true, 
      reply: reply,
      usage: completion.usage
    });
  } catch (error) {
    console.error('AI对话失败:', error);
    res.status(500).json({ error: 'AI对话失败: ' + error.message });
  }
});

// 流式AI对话
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages, documentContent } = req.body;
    
    console.log('收到流式对话请求，文档长度:', documentContent?.length || 0);
    
    const client = getOpenAIClient();
    if (!client) {
      console.error('API客户端未初始化');
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ error: '请先配置API密钥' })}\n\n`);
      res.end();
      return;
    }

    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    const chatMessages = [systemMessage];
    
    if (documentContent) {
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分，生成标准的Markdown表格。`
      });
    }

    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    console.log('调用AI API，模型:', process.env.OPENAI_MODEL || 'glm-4-flash');
    console.log('消息数量:', chatMessages.length);

    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 8000,
      stream: true
    });

    let totalContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        totalContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    console.log('AI响应完成，总长度:', totalContent.length);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('流式对话失败:', error.message);
    console.error('错误详情:', error);
    
    // 确保响应头已设置
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }
    res.write(`data: ${JSON.stringify({ error: '调用AI失败: ' + error.message })}\n\n`);
    res.end();
  }
});

// 循环调用 - 继续生成直到完成所有功能过程
app.post('/api/continue-analyze', async (req, res) => {
  try {
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30 } = req.body;
    
    const client = getOpenAIClient();
    if (!client) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    // 构建已完成的功能过程列表
    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];
    
    let userPrompt = '';
    if (round === 1) {
      userPrompt = `以下是功能文档内容：

${documentContent}

请对文档中的功能进行COSMIC拆分，输出Markdown表格。

【重要规则 - 必须严格遵守】：
1. **每个功能过程必须拆分为3-5个子过程**，绝对不能只有1-2个
2. **每个功能过程必须包含完整的数据移动序列**：
   - 第1行：E（输入/触发）
   - 第2-3行：R（读取数据库）和/或 W（写入数据库）
   - 最后1行：X（输出结果）
3. 示例结构（每个功能过程4行）：
   |功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
   |用户|用户请求|处理安全事件|接收事件请求|E|事件请求参数|事件ID、事件类型、触发时间|
   ||||读取事件详情|R|安全事件表|事件ID、事件级别、发生时间|
   ||||写入处理记录|W|事件处理表|处理ID、处理人、处理结果|
   ||||返回处理结果|X|事件响应数据|事件ID、处理状态、完成时间|

4. 尽可能多地识别功能过程，至少识别 ${targetFunctions} 个功能过程
5. 严格按照表格格式输出，每个功能过程占4-5行`;
    } else {
      userPrompt = `继续分析文档中尚未拆分的功能过程。

已完成的功能过程（${uniqueCompleted.length}个）：
${uniqueCompleted.slice(0, 20).join('、')}${uniqueCompleted.length > 20 ? '...' : ''}

目标是最终至少覆盖 ${targetFunctions} 个功能过程。

【重要规则 - 必须严格遵守】：
1. **每个功能过程必须拆分为3-5个子过程**，绝对不能只有1-2个
2. **每个功能过程必须包含完整的数据移动序列**：E → R/W → X
3. 示例：一个功能过程应该有4行（E+R+W+X）或5行（E+R+R+W+X）

请继续拆分文档中【其他尚未处理的功能】，输出Markdown表格格式。
如果所有功能都已拆分完成，请回复"[ALL_DONE]"。`;
    }

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    console.log(`第 ${round} 轮分析开始，已完成 ${uniqueCompleted.length} 个功能过程...`);

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [
        systemMessage,
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 8000
    });

    const reply = completion.choices[0].message.content;
    console.log(`第 ${round} 轮完成，响应长度: ${reply.length}`);

    // 检查是否完成
    const isDone = reply.includes('[ALL_DONE]') || reply.includes('已完成') || reply.includes('全部拆分');

    res.json({ 
      success: true, 
      reply: reply,
      round: round,
      isDone: isDone,
      completedFunctions: uniqueCompleted.length,
      targetFunctions
    });
  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

// 导出Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const { tableData, filename } = req.body;
    
    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
      return res.status(400).json({ error: '无有效数据可导出' });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cosmic拆分结果');

    // 设置列
    worksheet.columns = [
      { header: '功能用户', key: 'functionalUser', width: 25 },
      { header: '触发事件', key: 'triggerEvent', width: 15 },
      { header: '功能过程', key: 'functionalProcess', width: 30 },
      { header: '子过程描述', key: 'subProcessDesc', width: 35 },
      { header: '数据移动类型', key: 'dataMovementType', width: 15 },
      { header: '数据组', key: 'dataGroup', width: 25 },
      { header: '数据属性', key: 'dataAttributes', width: 50 }
    ];

    // 设置表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // 添加数据
    tableData.forEach((row, index) => {
      const dataRow = worksheet.addRow({
        functionalUser: row.functionalUser || '',
        triggerEvent: row.triggerEvent || '',
        functionalProcess: row.functionalProcess || '',
        subProcessDesc: row.subProcessDesc || '',
        dataMovementType: row.dataMovementType || '',
        dataGroup: row.dataGroup || '',
        dataAttributes: row.dataAttributes || ''
      });

      // 交替行颜色
      if (index % 2 === 1) {
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }

      dataRow.alignment = { vertical: 'middle', wrapText: true };
    });

    // 添加边框
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // 生成文件
    const buffer = await workbook.xlsx.writeBuffer();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'cosmic_result')}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('导出Excel失败:', error);
    res.status(500).json({ error: '导出Excel失败: ' + error.message });
  }
});

// AI智能去重 - 为重复的数据组/属性生成区分关键词
async function aiGenerateUniqueKeyword(originalName, subProcessDesc, functionalProcess, existingNames) {
  const client = getOpenAIClient();
  if (!client) {
    // 如果没有API，使用基于子过程描述的关键词
    return extractKeywordFromDesc(subProcessDesc);
  }

  try {
    const prompt = `你是一个数据命名专家。现在有一个数据组/数据属性名称"${originalName}"与已有名称重复。

上下文信息：
- 功能过程：${functionalProcess}
- 子过程描述：${subProcessDesc}
- 已存在的类似名称：${existingNames.slice(0, 5).join('、')}

请根据子过程描述的业务含义，生成一个2-4个字的中文关键词，用于区分这个数据组/属性。

要求：
1. 关键词必须来源于子过程描述的业务语义
2. 不要使用数字、符号或序号
3. 只输出关键词本身，不要其他解释

示例：
- 子过程"读取设备健康状态" → 健康状态
- 子过程"查询网络覆盖质量" → 覆盖质量
- 子过程"分析告警趋势" → 趋势分析`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 50
    });

    const keyword = completion.choices[0].message.content.trim();
    // 清理可能的多余内容
    const cleanKeyword = keyword.replace(/["""'''\n\r]/g, '').slice(0, 8);
    return cleanKeyword || extractKeywordFromDesc(subProcessDesc);
  } catch (error) {
    console.log('AI生成关键词失败，使用本地提取:', error.message);
    return extractKeywordFromDesc(subProcessDesc);
  }
}

// 本地关键词提取（备用方案）
function extractKeywordFromDesc(desc = '') {
  const cleaned = desc
    .replace(/[\d]/g, '')
    .replace(/[，。、""《》（）()？：；\-·]/g, ' ')
    .trim();
  if (!cleaned) return '扩展';
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  // 取前两个词的前4个字
  return tokens.slice(0, 2).map(t => t.slice(0, 4)).join('') || '扩展';
}

// 解析Markdown表格为结构化数据
app.post('/api/parse-table', async (req, res) => {
  try {
    const { markdown } = req.body;
    
    if (!markdown) {
      return res.status(400).json({ error: '无Markdown内容' });
    }

    // 提取表格内容
    const tableMatch = markdown.match(/\|[^\n]+\|[\s\S]*?\|[^\n]+\|/g);
    if (!tableMatch) {
      return res.status(400).json({ error: '未找到有效的Markdown表格' });
    }

    const rawLines = markdown.split('\n');
    const lines = rawLines.filter(line => line.trim().startsWith('|'));
    
    if (lines.length < 3) {
      return res.status(400).json({ error: '表格数据不完整' });
    }

    // 跳过表头和分隔行
    const dataLines = lines.slice(2);

    let currentFunctionalUser = '';
    let currentTriggerEvent = '';
    let currentFunctionalProcess = '';
    const pendingRows = [];

    const sanitizeText = (value = '') => value.replace(/-/g, '·').replace(/\s+/g, ' ').trim();

    const normalizeCells = (line) => {
      // 保留所有单元格，包括空的（用于合并单元格）
      const rawCells = line.split('|');
      // 去掉首尾的空字符串（由于 | 开头和结尾产生）
      if (rawCells.length > 0 && rawCells[0].trim() === '') rawCells.shift();
      if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
      return rawCells.map(cell => cell.trim());
    };

    dataLines.forEach((line, rowIdx) => {
      const cells = normalizeCells(line);
      console.log(`行 ${rowIdx}: cells.length=${cells.length}, cells=`, cells.slice(0, 7));
      
      // 只要有足够的列就处理（合并单元格时前几列可能为空）
      if (cells.length >= 4) {
        // 处理合并单元格情况
        if (cells[0]) currentFunctionalUser = cells[0];
        if (cells[1]) currentTriggerEvent = cells[1];
        if (cells[2]) currentFunctionalProcess = cells[2];

        let subProcessDesc = cells[3] || '';
        let dataMovementType = cells[4] || '';
        let dataGroup = cells[5] || '';
        let dataAttributes = cells[6] || '';

        const moveSet = new Set(['E', 'R', 'W', 'X']);
        const normalizedMove = (dataMovementType || '').toUpperCase();
        if (!moveSet.has(normalizedMove)) {
          const idx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (idx !== -1) {
            dataMovementType = (cells[idx] || '').toUpperCase();
            subProcessDesc = cells[idx - 1] || subProcessDesc;
            dataGroup = cells[idx + 1] || dataGroup;
            const attrCells = cells.slice(idx + 2);
            dataAttributes = attrCells.filter(Boolean).join(' | ') || dataAttributes;
          }
        } else {
          dataMovementType = normalizedMove;
        }

        // 如果仍然缺失，尝试从行数推断
        if (!dataMovementType) {
          const fallbackIdx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (fallbackIdx !== -1) {
            dataMovementType = (cells[fallbackIdx] || '').toUpperCase();
          }
        }

        // 如果数据组或数据属性缺失，自动拼接功能过程+子过程描述，尽量保持唯一
        if (!dataGroup) {
          dataGroup = `${currentFunctionalProcess || '功能过程'}·${subProcessDesc || '数据'}`;
        }

        if (!dataAttributes) {
          dataAttributes = `${currentFunctionalProcess || '功能过程'}ID | ${subProcessDesc || '子过程'}字段 | 记录时间`;
        }

        dataGroup = sanitizeText(dataGroup);
        dataAttributes = sanitizeText(dataAttributes);

        // 记录待处理的行数据，稍后统一处理重复
        pendingRows.push({
          functionalUser: cells[0] || currentFunctionalUser,
          triggerEvent: cells[1] || currentTriggerEvent,
          functionalProcess: cells[2] || currentFunctionalProcess,
          subProcessDesc,
          dataMovementType,
          dataGroup,
          dataAttributes,
          rowIdx
        });
      }
    });

    // 第二遍：处理重复的数据组和数据属性（调用AI智能去重）
    const tableData = [];
    const seenGroupsMap = new Map(); // 记录已出现的数据组及其来源
    const seenAttrsMap = new Map();  // 记录已出现的数据属性及其来源

    for (const row of pendingRows) {
      let { dataGroup, dataAttributes, subProcessDesc, functionalProcess } = row;
      
      // 处理数据组重复
      const groupKey = dataGroup.toLowerCase();
      if (seenGroupsMap.has(groupKey)) {
        const existingNames = Array.from(seenGroupsMap.values()).map(v => v.name);
        // 调用AI生成区分关键词
        const keyword = await aiGenerateUniqueKeyword(dataGroup, subProcessDesc, functionalProcess, existingNames);
        dataGroup = `${dataGroup}（${keyword}）`;
        console.log(`数据组去重: "${row.dataGroup}" → "${dataGroup}"`);
      }
      seenGroupsMap.set(dataGroup.toLowerCase(), { name: dataGroup, desc: subProcessDesc });

      // 处理数据属性重复
      const attrKey = dataAttributes.toLowerCase();
      if (seenAttrsMap.has(attrKey)) {
        const existingNames = Array.from(seenAttrsMap.values()).map(v => v.name);
        // 调用AI生成区分关键词
        const keyword = await aiGenerateUniqueKeyword(dataAttributes, subProcessDesc, functionalProcess, existingNames);
        dataAttributes = `${dataAttributes}（${keyword}）`;
        console.log(`数据属性去重: "${row.dataAttributes}" → "${dataAttributes}"`);
      }
      seenAttrsMap.set(dataAttributes.toLowerCase(), { name: dataAttributes, desc: subProcessDesc });

      tableData.push({
        ...row,
        dataGroup,
        dataAttributes
      });
    }

    res.json({ success: true, tableData });
  } catch (error) {
    console.error('解析表格失败:', error);
    res.status(500).json({ error: '解析表格失败: ' + error.message });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Cosmic拆分智能体服务器运行在 http://localhost:${PORT}`);
  console.log(`📋 API密钥状态: ${process.env.OPENAI_API_KEY ? '已配置' : '未配置'}`);
});
