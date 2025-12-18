import React, { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Upload,
  FileText,
  Search,
  Lightbulb,
  Target,
  Calendar,
  Users,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  X,
  Plus,
  Trash2,
  BookOpen,
  Brain,
  ClipboardList
} from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * 需求文档助手 - 生成调研大纲
 */
function RequirementAssistant({ apiStatus, setShowSettings }) {
  // 状态管理
  const [documents, setDocuments] = useState([]); // 多个需求文档
  const [userIdea, setUserIdea] = useState(''); // 用户想法描述
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null); // 分析结果
  const [streamingContent, setStreamingContent] = useState('');
  const [currentPhase, setCurrentPhase] = useState(''); // thinking | generating
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    analysis: true,
    outline: true
  });
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);

  // 系统提示词
  const SYSTEM_PROMPT = `你是一名资深产品需求分析师，擅长从模糊输入中识别核心问题，并制定针对性调研计划。你的任务是基于具体需求内容，生成个性化的实用调研指南。

## 核心任务
分析用户上传的多个需求文档附件和用户想法记录，识别其中的模糊点和关键问题，生成有针对性的产品调研大纲，帮助团队高效澄清需求。

## 处理流程
1. 首先分析输入内容，识别主要需求领域和模糊点
2. 基于分析结果，确定调研重点和优先级
3. 针对识别出的具体问题，设计相应的澄清方法
4. 生成可立即执行的调研计划

## 生成原则
- **针对性**：基于具体需求内容定制，非通用模板
- **实用性**：提供具体问题和执行步骤
- **重点突出**：聚焦最关键的不明确点
- **循序渐进**：从理解到验证的完整闭环

## 输出格式要求

请严格按照以下Markdown格式输出：

### 第一部分：输入内容分析

#### 1. 主要需求领域
[识别出的核心领域，2-3个]

#### 2. 关键模糊点和矛盾之处
[列举3-5个具体的模糊点]

#### 3. 最需要澄清的核心问题
[3-5个最重要的问题]

---

### 第二部分：针对性调研大纲

## 一、调研重点聚焦

### 首要澄清事项
[基于分析得出的最紧急问题]

### 关键决策点
[需要达成的关键共识，2-3个]

### 成功标准
[如何判断需求已明确，具体可衡量]

---

## 二、分阶段调研计划

### 阶段1：概念对齐（1-2天）

**关键活动：**
1. 启动会议：确认核心概念的理解一致性
2. 术语定义：统一关键术语含义
3. 范围框定：明确边界

**具体要问的问题：**
1. [具体问题1]
2. [具体问题2]
3. [具体问题3]

**预期产出：**
- [产出物1]
- [产出物2]

---

### 阶段2：场景细化（2-3天）

**关键活动：**
1. 用户场景还原：梳理典型流程
2. 痛点验证：确认是否真实存在
3. 用例梳理：转化为具体使用场景

**具体要问的问题：**
1. [具体问题1]
2. [具体问题2]
3. [具体问题3]

**预期产出：**
- [产出物1]
- [产出物2]

---

### 阶段3：需求确认（1-2天）

**关键活动：**
1. 优先级确认：基于业务价值排序
2. 验收标准明确：定义完成标准
3. 风险识别：标记不确定性

**具体产出：**
- 清晰的需求描述文档
- 优先级排序清单
- 明确的验收标准
- 风险清单

---

## 三、个性化建议

### 调研技巧
[针对识别出的问题类型，提供2-3条具体建议]

### 沟通要点
[与不同干系人沟通的注意事项]

### 验证方法
[如何验证关键假设]

---

## 四、时间安排建议

| 阶段 | 时间 | 负责人建议 | 关键里程碑 |
|-----|------|-----------|----------|
| 概念对齐 | 1-2天 | [建议角色] | [里程碑] |
| 场景细化 | 2-3天 | [建议角色] | [里程碑] |
| 需求确认 | 1-2天 | [建议角色] | [里程碑] |

---

## 五、风险提示

### 高风险项
[识别出的高风险事项，需特别关注]

### 依赖项
[调研过程中的关键依赖]

### 应急预案
[如果遇到阻塞如何处理]

---

请严格遵循上述格式，确保内容基于具体输入，可直接执行。`;

  // 处理文件上传
  const handleFileUpload = useCallback(async (files) => {
    const newDocs = [];
    for (let file of Array.from(files)) {
      const ext = file.name.split('.').pop().toLowerCase();
      let content = '';
      
      if (ext === 'txt' || ext === 'md') {
        content = await file.text();
      } else if (ext === 'docx' || ext === 'doc') {
        // 对于Word文件，标记待处理
        content = `[待解析: ${file.name}]`;
      }
      
      newDocs.push({
        name: file.name,
        content: content,
        file: file
      });
    }
    
    setDocuments(prev => [...prev, ...newDocs]);
  }, []);

  // 拖拽处理
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  // 删除文档
  const removeDocument = (index) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  // 生成调研大纲
  const generateOutline = async () => {
    if (documents.length === 0 && !userIdea.trim()) {
      setError('请至少上传一个需求文档或填写用户想法');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setStreamingContent('');
    setAnalysisResult(null);
    setCurrentPhase('analyzing');

    try {
      // 准备文档内容
      let combinedContent = '';
      
      // 添加用户想法
      if (userIdea.trim()) {
        combinedContent += `## 【用户想法记录】\n\n${userIdea}\n\n---\n\n`;
      }
      
      // 添加文档内容
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        combinedContent += `## 【需求文档 ${i + 1}：${doc.name}】\n\n`;
        
        if (doc.content.startsWith('[待解析:')) {
          // 需要通过后端解析Word文件
          const formData = new FormData();
          formData.append('file', doc.file);
          
          try {
            const parseRes = await axios.post('/api/parse-word', formData);
            combinedContent += parseRes.data.text || '';
          } catch (err) {
            combinedContent += `[文件解析失败: ${err.message}]\n`;
          }
        } else {
          combinedContent += doc.content;
        }
        
        combinedContent += '\n\n---\n\n';
      }

      // 调用AI生成调研大纲
      const userPrompt = `请根据以下需求文档和用户想法，生成针对性的调研大纲：

${combinedContent}

请严格按照系统提示中的格式输出，确保内容具体、可执行。`;

      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              setIsAnalyzing(false);
              setAnalysisResult(fullContent);
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
              if (parsed.error) {
                setError(parsed.error);
                setIsAnalyzing(false);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (err) {
      setError('生成调研大纲失败: ' + (err.response?.data?.error || err.message));
      setIsAnalyzing(false);
    }
  };

  // 切换展开/收起
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // 导出调研大纲
  const exportOutline = () => {
    if (!analysisResult) return;

    const blob = new Blob([analysisResult], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `调研大纲_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：文档上传和用户想法输入 */}
        <div className="lg:col-span-1 space-y-4">
          {/* 功能介绍卡片 */}
          <div className="bg-white rounded-xl shadow-claude border border-claude-border p-6 transition-all duration-300 hover:shadow-claude-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-claude-accent-primary flex items-center justify-center shadow-sm">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-serif font-bold text-claude-text-primary">需求文档助手</h2>
                <p className="text-xs text-claude-text-muted">AI驱动的需求调研大纲生成器</p>
              </div>
            </div>
            
            <div className="space-y-2 text-sm text-claude-text-secondary">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>识别需求中的模糊点和矛盾</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>生成针对性的调研计划</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>提供可执行的访谈问题</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                <span>明确时间安排和风险点</span>
              </div>
            </div>
          </div>

          {/* 文件上传区 */}
          <div className="bg-white rounded-xl shadow-claude border border-claude-border p-6 transition-all duration-300 hover:shadow-claude-lg">
            <h3 className="text-base font-serif font-bold text-claude-text-primary mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-claude-accent-primary" />
              上传需求文档
            </h3>
            
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                isDragging
                  ? 'border-claude-accent-primary bg-claude-accent-light'
                  : 'border-claude-border-warm hover:border-claude-accent-primary hover:bg-claude-bg-warm'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc,.txt,.md"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3 bg-claude-bg-cream text-claude-text-muted">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-claude-text-primary font-medium mb-1">拖拽文件到此处或点击上传</p>
              <p className="text-xs text-claude-text-muted">支持多个文件：.docx, .doc, .txt, .md</p>
            </div>

            {/* 已上传文档列表 */}
            {documents.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium text-claude-text-secondary mb-2">
                  已上传文档 ({documents.length})
                </div>
                {documents.map((doc, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-claude-bg-cream border border-claude-border-warm rounded-lg flex items-center gap-3 group hover:bg-claude-bg-warm transition-colors"
                  >
                    <FileText className="w-4 h-4 text-claude-accent-primary flex-shrink-0" />
                    <span className="text-sm text-claude-text-primary truncate flex-1">{doc.name}</span>
                    <button
                      onClick={() => removeDocument(idx)}
                      className="text-claude-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="删除"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 用户想法输入 */}
          <div className="bg-white rounded-xl shadow-claude border border-claude-border p-6 transition-all duration-300 hover:shadow-claude-lg">
            <h3 className="text-base font-serif font-bold text-claude-text-primary mb-3 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-claude-accent-primary" />
              用户想法描述（可选）
            </h3>
            
            <textarea
              value={userIdea}
              onChange={(e) => setUserIdea(e.target.value)}
              placeholder="如果有额外的用户需求或想法，请在此输入...&#10;&#10;例如：&#10;- 用户希望系统能够...&#10;- 目前的痛点是...&#10;- 期望达到的目标..."
              className="w-full h-48 p-4 border border-claude-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-claude-accent-primary/20 focus:border-claude-accent-primary text-sm bg-claude-bg-warm transition-all"
            />
            
            <div className="mt-2 text-xs text-claude-text-muted">
              提示：可以描述用户的需求、痛点、期望目标等
            </div>
          </div>

          {/* 生成按钮 */}
          <button
            onClick={generateOutline}
            disabled={isAnalyzing || !apiStatus.hasApiKey}
            className="w-full flex items-center justify-center gap-2 py-3 bg-claude-accent-primary text-white rounded-xl font-medium hover:bg-claude-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在生成调研大纲...
              </>
            ) : (
              <>
                <ClipboardList className="w-5 h-5" />
                生成调研大纲
              </>
            )}
          </button>

          {!apiStatus.hasApiKey && (
            <p className="text-center text-sm text-amber-600">
              请先<button onClick={() => setShowSettings(true)} className="underline hover:text-amber-700">配置API密钥</button>
            </p>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：调研大纲结果 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 生成中提示 */}
          {isAnalyzing && (
            <div className="bg-white rounded-xl shadow-claude border border-claude-border p-6 transition-all duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-claude-accent-primary/10 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-claude-accent-primary animate-spin" />
                </div>
                <div>
                  <h3 className="font-medium text-claude-text-primary">AI正在分析中...</h3>
                  <p className="text-sm text-claude-text-secondary">
                    正在识别需求模糊点、生成调研计划和访谈问题
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 流式输出内容 */}
          {streamingContent && (
            <div className="bg-white rounded-xl shadow-claude border border-claude-border p-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-serif font-bold text-claude-text-primary flex items-center gap-2">
                  <Target className="w-6 h-6 text-claude-accent-primary" />
                  调研大纲
                </h2>
                
                {analysisResult && (
                  <button
                    onClick={exportOutline}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-claude-border rounded-lg text-sm hover:bg-claude-bg-cream hover:text-claude-text-primary transition-all shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    导出Markdown
                  </button>
                )}
              </div>

              {/* Markdown渲染 */}
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-claude-text-primary mt-6 mb-4 pb-2 border-b-2 border-claude-border-warm" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xl font-bold text-claude-text-primary mt-6 mb-3" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-lg font-semibold text-claude-text-primary mt-4 mb-2" {...props} />,
                    h4: ({node, ...props}) => <h4 className="text-base font-semibold text-claude-text-secondary mt-3 mb-2" {...props} />,
                    p: ({node, ...props}) => <p className="text-claude-text-secondary leading-relaxed mb-3" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc list-inside space-y-1 mb-3 text-claude-text-secondary" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal list-inside space-y-1 mb-3 text-claude-text-secondary" {...props} />,
                    li: ({node, ...props}) => <li className="ml-4" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-semibold text-claude-text-primary" {...props} />,
                    table: ({node, ...props}) => (
                      <div className="overflow-x-auto my-4">
                        <table className="min-w-full border-collapse border border-claude-border" {...props} />
                      </div>
                    ),
                    thead: ({node, ...props}) => <thead className="bg-claude-bg-warm" {...props} />,
                    th: ({node, ...props}) => <th className="border border-claude-border px-4 py-2 text-left font-semibold text-claude-text-primary" {...props} />,
                    td: ({node, ...props}) => <td className="border border-claude-border px-4 py-2 text-claude-text-secondary" {...props} />,
                    hr: ({node, ...props}) => <hr className="my-6 border-t-2 border-claude-border-warm" {...props} />,
                    blockquote: ({node, ...props}) => (
                      <blockquote className="border-l-4 border-claude-accent-primary bg-claude-bg-warm pl-4 py-2 my-3 italic text-claude-text-secondary" {...props} />
                    ),
                  }}
                >
                  {streamingContent}
                </ReactMarkdown>
              </div>

              {/* 生成完成提示 */}
              {analysisResult && (
                <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">调研大纲生成完成！</span>
                  </div>
                  <p className="text-sm text-green-600 mt-1">
                    您可以根据此大纲开展调研工作，也可以导出为Markdown文件分享给团队。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 空状态 */}
          {!isAnalyzing && !streamingContent && (
            <div className="bg-white rounded-xl shadow-claude border border-claude-border p-12 text-center h-full flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-3xl bg-claude-bg-warm border border-claude-border shadow-sm flex items-center justify-center mb-6">
                <ClipboardList className="w-10 h-10 text-claude-text-light" />
              </div>
              <h3 className="text-xl font-serif font-medium text-claude-text-primary mb-2">准备生成调研大纲</h3>
              <p className="text-claude-text-secondary max-w-md mx-auto mb-6">
                上传需求文档，选填用户想法描述，点击"生成调研大纲"。AI将深度分析需求内容，识别模糊点和关键问题，为您生成针对性的调研计划。
              </p>
              
              {/* 使用说明 */}
              <div className="w-full max-w-2xl bg-claude-bg-cream rounded-xl p-6 text-left">
                <h4 className="text-sm font-semibold text-claude-text-primary mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  使用步骤
                </h4>
                <ol className="space-y-2 text-sm text-claude-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-claude-accent-primary text-white text-xs flex items-center justify-center mt-0.5">1</span>
                    <span>上传一个或多个需求文档（支持Word、Markdown、TXT格式）</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-claude-accent-primary text-white text-xs flex items-center justify-center mt-0.5">2</span>
                    <span>（可选）在"用户想法描述"中补充额外信息</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-claude-accent-primary text-white text-xs flex items-center justify-center mt-0.5">3</span>
                    <span>点击"生成调研大纲"，AI将分析并生成个性化调研计划</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-claude-accent-primary text-white text-xs flex items-center justify-center mt-0.5">4</span>
                    <span>查看分析结果，导出Markdown文件用于团队协作</span>
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RequirementAssistant;

