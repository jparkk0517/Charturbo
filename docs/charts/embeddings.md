# Embeddings · Similarity

`loadEmbeddings` projects high-dimensional vectors (any dimension of 3 or more: 128, 768, 1536, 3072, ...) to 3D and links each vector to its most cosine-similar neighbors, all in Rust. `queryCosineSimilar` then returns exact cosine similarity computed in the original dimension. Use it to explore document or image embeddings, clusters and nearest neighbors visually.

[Live example](https://jparkk0517.github.io/Charturbo/embeddings.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const dimensions = 1536; // e.g. OpenAI text-embedding-3
const count = 1000;
const vectors = new Float32Array(count * dimensions); // fill with your embeddings

const stats = sdk.loadEmbeddings(vectors, {
  dimensions,
  projection: 'pca',
  kNeighbors: 4,
  similarityThreshold: 0.3,
});
console.log(`${stats.nodeCount} vectors, ${stats.edgeCount} edges, ${stats.elapsedMs.toFixed(0)} ms`);

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  onNodeClick: (node) => {
    if (node) console.log(sdk.queryCosineSimilar(node.id, 5));
  },
});
sdk.fitToView();
sdk.render();
```

## Data format

`vectors` is one flat `Float32Array` of `N × dimensions` values, row by row: vector `i` occupies `vectors[i * dimensions .. (i + 1) * dimensions)`. Vector `i` becomes node `i`.

The length must be a non-zero multiple of `dimensions`; otherwise `loadEmbeddings` throws `vectors length (<length>) must be a non-zero multiple of dimensions (<dimensions>)`. `dimensions` is floored to an integer and raised to at least 3.

Loading embeddings replaces the current graph or chart. Afterwards the result is a regular 3D graph: node metadata, tooltips, selection, camera and the force simulation from [3D Network Graph](./graph-3d) all apply.

## Options

`loadEmbeddings(vectors, options: HighDimEmbeddingOptions)`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dimensions` | `number` | (required) | Vector dimension D |
| `projection` | `'pca' \| 'pca-umap' \| 'random-projection'` | `'pca-umap'` | R<sup>D</sup> → R<sup>3</sup> reduction |
| `kNeighbors` | `number` | `5` | Most similar neighbors linked per vector |
| `similarityThreshold` | `number` | `0.35` | Minimum cosine similarity in [-1, 1] for an edge |
| `clusters` | `Uint16Array` | | Cluster ID per vector (length N). When omitted, Rust runs spherical k-means in the original D-dimensional space |
| `umapWarmupTicks` | `number` | `35` | Force-layout warmup ticks for `'pca-umap'` |
| `spaceRadius` | `number` | `85` | Radius of the target 3D bounding sphere |

Return value: `{ nodeCount, edgeCount, dimensions, elapsedMs }`, where `elapsedMs` is the projection and k-NN time measured around the call.

### Projection modes

| Mode | Description |
| --- | --- |
| `'pca'` | Principal component analysis by matrix-free power iteration |
| `'pca-umap'` | PCA, then `umapWarmupTicks` steps of the force layout over the k-NN graph |
| `'random-projection'` | Johnson–Lindenstrauss random projection |

## Similarity queries

```ts
const top = sdk.queryCosineSimilar(0, 5);
// [{ nodeId: 812, cosineSimilarity: 0.8731, label: 'doc-0812' }, ...]
```

- `queryCosineSimilar(nodeId, topK = 8)` returns `CosineSimilarityMatch[]` (`nodeId`, `cosineSimilarity`, `label`), computed exactly in the original R<sup>D</sup> space, not in the 3D projection. `cosineSimilarity` is rounded to 4 decimals; `label` comes from the node metadata (`Node #<id>` when none).
- `embeddingDimension()` returns the active D, or `0` when the data was loaded as 3D coordinates.

Attach labels with `setNodeMetadata` so tooltips, search and similarity results are readable:

```ts
sdk.setNodeMetadata(Array.from(topicIds, (topic, i) => ({
  label: `doc-${String(i).padStart(4, '0')}`,
  category: TOPICS[topic],
})));
```

## Synthetic test data

`Charturbo.generateSyntheticHighDimEmbeddings(nodeCount, dimensions, clusterCount = 8, seed = 42)` returns `{ vectors, clusters }`: normalized vectors grouped around `clusterCount` prototypes, for trying out dimensions and settings.

```ts
const { vectors, clusters } = Charturbo.generateSyntheticHighDimEmbeddings(800, 768, 6);
sdk.loadEmbeddings(vectors, { dimensions: 768, projection: 'pca', clusters });
```

## Notes

- Vectors are L2-normalized before projection, so only their direction matters. The engine keeps the normalized copy (`N × D` 32-bit floats) for exact similarity queries.
- The engine also rejects non-finite values (`embedding vectors must be finite numbers (no NaN / Infinity)`) and a `clusters` array whose length is not N (`clusters slice length must match vector count N`); `loadEmbeddings` throws with these messages.
- Clicking a node highlights its k-NN edges (`highlightNeighborsOnClick`, default `1`).

## See also

- [3D Network Graph](./graph-3d)
- [Tooltips & Hover](../guide/tooltips)
- [Performance](../guide/performance)
