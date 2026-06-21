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
SEMANTIC_LINK_THRESHOLD=0.55
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

当前请求使用 `jina-embeddings-v3` 的基础表示，没有指定 task-specific LoRA adapter。项目把 embedding cosine similarity 作为词语语义接近程度的计算性指标，而不是对人类心理词典或激活扩散过程的直接测量。

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

| 关系类型 | 含义 | 示例 |
| --- | --- | --- |
| `Taxonomic` | 上下位或类别归属关系，一个词是另一个词的类型或上位类。 | `apple -> fruit`、`cat -> animal` |
| `Coordinate` | 同一类别中的并列成员，两个词共享相近的上位概念。 | `cat -> dog`、`apple -> pear` |
| `Part-whole` | 部分与整体之间的构成关系。 | `wheel -> car`、`leaf -> tree` |
| `Functional` | 使用、用途、工具或功能上的关系。 | `key -> door`、`knife -> food` |
| `Thematic` | 出现在同一事件、场景或角色框架中的关系，不要求属于同一类别。 | `doctor -> hospital`、`rain -> umbrella` |
| `Causal` | 原因、结果或后果之间的关系。 | `rain -> flood`、`crime -> prison` |
| `Contrast` | 反义、对立或具有显著对照的关系。 | `war -> peace`、`prison -> freedom` |
| `World-knowledge` | 主要依赖文化、制度、历史或百科知识才能建立的关系。 | `music -> copyright`、`university -> degree` |
| `Other` | 存在可解释的联系，但不适合归入上述主要类别。 | 依具体语境判断 |

这些关系并不总是互斥。例如 `doctor -> hospital` 同时可以涉及功能和场景关系；系统会选择当前路径中最突出的主要关系类型。

## Render 部署

项目通过仓库根目录的 `render.yaml` 部署为 Render Web Service。Blueprint 中已经配置：

- Free 实例
- Node.js 20.19.2
- 构建命令：`npm ci && npm run build`
- 启动命令：`npm run start`
- 健康检查路径：`/`

在 Render 创建 Blueprint 并连接 GitHub 仓库后，需要在 Render 控制台填写以下 Secret 环境变量：

```text
JINA_API_KEY
OPENROUTER_API_KEY
```

其余模型名称和阈值由 `render.yaml` 提供。当前线上地址为：

```text
https://language-mind-course-project.onrender.com
```

GitHub 主分支更新后，可以在对应 Web Service 中选择 **Manual Deploy -> Deploy latest commit** 部署最新版本。Blueprint 的 **Manual sync** 只负责同步 `render.yaml` 配置，不等同于部署最新应用代码。

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

该文件已加入 `.gitignore`，不会提交到 GitHub。统计内容包括：

- Jina 请求次数和估算输入 tokens
- OpenRouter 请求次数、输入 tokens、输出 tokens

也可以通过 `GET /api/usage` 读取统计。Render 免费实例使用临时文件系统，因此 `data/usage.json` 会在服务重启或重新部署后清零。这套统计只用于课程演示，不适合作为长期、精确的计费记录；如果未来要多人长期使用，可以迁移到外部数据库。

## 方法局限

- Embedding cosine similarity 是语义接近程度的工程化近似，不是人类词语联想强度或反应时的直接实验数据。
- `SEMANTIC_LINK_THRESHOLD=0.55` 是游戏使用的启发式阈值，不应解释为心理学概率。
- OpenRouter 模型生成的 relation type 和 explanation 是对已接受路径的自动解释，可能与不同参与者的主观联想不同。
- 不同玩家选择的路径仍可用于讨论个体经验、语境和世界知识如何影响词语联想，但不能据此得出一般性认知结论。
