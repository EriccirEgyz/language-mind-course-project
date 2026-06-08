# Mind Orienteering

语言与心智课程创意项目：一个用 AI 语义判断实现的英文名词联想小游戏，用来展示心理词典、语义网络、激活扩散和语境中的意义。

## 项目想法

玩家从一个英文起点名词出发，每次输入一个与当前词相关的英文名词，尝试到达目标词。

例子：

```text
apple -> fruit -> health -> doctor -> hospital
```

每一步都会由后端调用 Jina 和 OpenRouter：

1. Jina Embeddings API 把词语映射成向量，并计算 cosine similarity。
2. 如果 `previous -> current` 的 link score 达到阈值，这一步被接受；否则被拒绝。
3. 对 accepted links，OpenRouter Qwen chat 模型只负责分类 relationType 和生成解释。

本项目**不使用内置语义图谱兜底**。如果服务器没有配置 `OPENROUTER_API_KEY`，游戏会明确提示 AI 判断服务未配置。

输入提示：

- 游戏界面提示玩家使用英文名词。
- 程序不再做前端/后端词性检查；每一步直接用 Jina embedding 计算相似度。
- Custom Challenge 也只提示用户输入英文名词，不额外校验。

关卡来源：

- Curated Challenge：预设的展示关卡。
- Random Challenge：调用 OpenRouter Qwen 生成一组新的 start/target 英文名词。
- Custom Challenge：用户自己输入 start/target。

## 课程关联

主要对应课件：

- `Lecture05_Lexical Access.pdf`
  - Lexicon 心理词典
  - Word Association Task 词语联想任务
  - Semantic Network 语义网络
  - Spreading Activation 激活扩散
  - Semantic Priming 语义启动
- `Lecture07_Meaning in context.pdf`
  - semantic meaning 与 pragmatic meaning
  - context、inference 和 world knowledge 对意义理解的影响

项目解释：

- 每个词是心理词典中的一个节点。
- 每一步联想是在语义网络中移动。
- 相关词更容易被想到，对应激活扩散。
- 不同玩家路径不同，体现个体经验、语境和世界知识对词义联想的影响。

## 技术栈

- Next.js 16 App Router
- React 19
- Jina Embeddings API
- OpenRouter Chat Completions API

## 本地运行

```bash
npm install
cp .env.example .env.local
```

编辑 `.env.local`：

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key
JINA_API_KEY=jina_your-key
JINA_EMBEDDING_MODEL=jina-embeddings-v3
OPENROUTER_USE_EMBEDDINGS=true
OPENROUTER_EMBEDDING_MODEL=jina-embeddings-v3
OPENROUTER_CHAT_MODEL=qwen/qwen-plus-2025-07-28
NEXT_PUBLIC_APP_URL=http://localhost:3000
SEMANTIC_LINK_THRESHOLD=0.60
```

启动：

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

## 相关性如何判断

后端接口：`POST /api/judge`

请求：

```json
{
  "previous": "apple",
  "current": "fruit",
  "target": "hospital",
  "path": ["apple"]
}
```

判断流程：

1. 调用 Jina Embeddings API 获取 `previous`、`current`、`target` 三个词的向量。
2. 计算：
   - `previous` 与 `current` 的 cosine similarity：这一步联想是否顺畅。
   - `current` 与 `target` 的 cosine similarity：当前词离目标有多近。
   - `currentToTarget - previousToTarget`：这一步是否更接近目标。
3. 如果 `link_score >= SEMANTIC_LINK_THRESHOLD`，这一步 accepted；否则 rejected。
4. 只有 accepted links 会再调用 OpenRouter Qwen，生成 relationType 和 explanation。

```json
{
  "accepted": true,
  "relationType": "Taxonomic",
  "explanation": "Apple is a kind of fruit, so the association is direct and natural.",
  "scores": {
    "link": 0.812,
    "currentToTarget": 0.334,
    "previousToTarget": 0.219,
    "progressDelta": 0.115,
    "source": "embedding"
  }
}
```

关系类型使用：

```text
Taxonomic / Coordinate / Part-whole / Functional / Thematic / Causal / Contrast / World-knowledge / Other
```

其中 `Taxonomic` 表示上下位类关系，如 `apple -> fruit`；`Coordinate` 表示同类并列词，如 `cat -> dog`；`Thematic` 表示同一事件或场景中的关系，如 `doctor -> hospital`；`World-knowledge` 表示主要依赖文化、制度、历史或百科知识的关系。

## 阿里云 ECS 部署

和你之前的 Next.js 项目类似，可以用 pm2 + Caddy。

服务器上：

```bash
git clone https://github.com/EriccirEgyz/language-mind-course-project.git
cd language-mind-course-project
npm ci
cp .env.example .env.local
nano .env.local
npm run build
pm2 start npm --name mind-orienteering -- start
```

Caddyfile 示例：

```caddy
your-domain.com {
    reverse_proxy localhost:3000
}
```

如果没有备案或 80/443 不方便使用，可以先用服务器公网 IP + 3000 端口测试，但正式展示更建议配置域名和反向代理。

## AI 工具使用说明

项目开发中使用 AI 编程工具辅助：

- 设计网页结构、交互流程和视觉样式。
- 编写 Next.js 前端与 API route。
- 设计 semantic judge 的 prompt 和 JSON 输出格式。
- 辅助整理课程概念与项目说明。

运行时使用：

- Jina embedding 模型：计算词语向量相似度。
- OpenRouter chat 模型：判断联想关系类型并生成解释。

## 用量统计

服务器端会把运行时用量累计写入：

```text
data/usage.json
```

该文件已加入 `.gitignore`，不会提交到 GitHub。页面右侧有 API 用量面板，显示：

- Jina 请求次数和估算输入 tokens
- OpenRouter 请求次数、输入 tokens、输出 tokens

这是单机部署友好的轻量统计方案；如果未来要多人长期使用，可以迁移到 SQLite/Prisma。
