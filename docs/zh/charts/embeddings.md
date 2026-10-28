# 嵌入向量 · 相似度

`loadEmbeddings` 将高维向量（任意不小于 3 的维度：128、768、1536、3072……）投影到 3D，并把每个向量与余弦相似度最高的邻居相连，全部计算都在 Rust 中完成。之后 `queryCosineSimilar` 返回在原始维度中计算的精确余弦相似度。适用于直观探索文档或图像嵌入向量、聚类和最近邻。

[在线示例](https://jparkk0517.github.io/Charturbo/embeddings.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const dimensions = 1536; // 例如 OpenAI text-embedding-3
const count = 1000;
const vectors = new Float32Array(count * dimensions); // 填入你的嵌入向量

const stats = sdk.loadEmbeddings(vectors, {
  dimensions,
  projection: 'pca',
  kNeighbors: 4,
  similarityThreshold: 0.3,
});
console.log(`${stats.nodeCount} 个向量，${stats.edgeCount} 条边，${stats.elapsedMs.toFixed(0)} ms`);

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  onNodeClick: (node) => {
    if (node) console.log(sdk.queryCosineSimilar(node.id, 5));
  },
});
sdk.fitToView();
sdk.render();
```

## 数据格式

`vectors` 是一个按行排列 `N × dimensions` 个值的扁平 `Float32Array`：向量 `i` 占据 `vectors[i * dimensions .. (i + 1) * dimensions)`，并成为节点 `i`。

长度必须是 `dimensions` 的非零倍数，否则 `loadEmbeddings` 抛出 `vectors length (<length>) must be a non-zero multiple of dimensions (<dimensions>)`。`dimensions` 向下取整，且至少为 3。

加载嵌入向量会替换当前的图或图表。加载后的结果是普通的 3D 图：[3D 网络图](./graph-3d)中的节点元数据、提示框、选择、相机和力导向仿真都适用。

## 选项

`loadEmbeddings(vectors, options: HighDimEmbeddingOptions)`：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dimensions` | `number` | （必填） | 向量维度 D |
| `projection` | `'pca' \| 'pca-umap' \| 'random-projection'` | `'pca-umap'` | R<sup>D</sup> → R<sup>3</sup> 降维方式 |
| `kNeighbors` | `number` | `5` | 每个向量连接的最相似邻居数 |
| `similarityThreshold` | `number` | `0.35` | 建立边所需的最小余弦相似度，[-1, 1] |
| `clusters` | `Uint16Array` | | 每个向量的聚类 ID（长度 N）。省略时 Rust 在原始 D 维空间中运行球面 k-means |
| `umapWarmupTicks` | `number` | `35` | `'pca-umap'` 下力导向布局的预热步数 |
| `spaceRadius` | `number` | `85` | 目标 3D 包围球半径 |

返回值：`{ nodeCount, edgeCount, dimensions, elapsedMs }`，其中 `elapsedMs` 是在调用前后测得的投影和 k-NN 耗时。

### 投影方式

| 方式 | 说明 |
| --- | --- |
| `'pca'` | 基于无矩阵幂迭代（matrix-free power iteration）的主成分分析 |
| `'pca-umap'` | 先做 PCA，再在 k-NN 图上运行 `umapWarmupTicks` 步力导向布局 |
| `'random-projection'` | Johnson–Lindenstrauss 随机投影 |

## 相似度查询

```ts
const top = sdk.queryCosineSimilar(0, 5);
// [{ nodeId: 812, cosineSimilarity: 0.8731, label: 'doc-0812' }, ...]
```

- `queryCosineSimilar(nodeId, topK = 8)` 返回 `CosineSimilarityMatch[]`（`nodeId`、`cosineSimilarity`、`label`），在原始 R<sup>D</sup> 空间中精确计算，而不是在 3D 投影中。`cosineSimilarity` 保留 4 位小数；`label` 取自节点元数据（没有时为 `Node #<id>`）。
- `embeddingDimension()` 返回当前的 D；数据以 3D 坐标加载时为 `0`。

用 `setNodeMetadata` 添加标签，让提示框、搜索和相似度结果更易读：

```ts
sdk.setNodeMetadata(Array.from(topicIds, (topic, i) => ({
  label: `doc-${String(i).padStart(4, '0')}`,
  category: TOPICS[topic],
})));
```

## 合成测试数据

`Charturbo.generateSyntheticHighDimEmbeddings(nodeCount, dimensions, clusterCount = 8, seed = 42)` 返回 `{ vectors, clusters }`：围绕 `clusterCount` 个原型分布的归一化向量，用于试验不同维度和设置。

```ts
const { vectors, clusters } = Charturbo.generateSyntheticHighDimEmbeddings(800, 768, 6);
sdk.loadEmbeddings(vectors, { dimensions: 768, projection: 'pca', clusters });
```

## 说明

- 向量在投影前做 L2 归一化，因此只有方向有意义。引擎保留归一化后的副本（`N × D` 个 32 位浮点数）用于精确的相似度查询。
- 引擎还会拒绝非有限值（`embedding vectors must be finite numbers (no NaN / Infinity)`）以及长度不等于 N 的 `clusters` 数组（`clusters slice length must match vector count N`），`loadEmbeddings` 会以这些消息抛出异常。
- 单击节点会高亮其 k-NN 边（`highlightNeighborsOnClick`，默认 `1`）。

## 另请参阅

- [3D 网络图](./graph-3d)
- [提示框与悬停](../guide/tooltips)
- [性能](../guide/performance)
