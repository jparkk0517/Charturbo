# 임베딩 · 유사도

`loadEmbeddings`는 고차원 벡터(3 이상의 모든 차원: 128, 768, 1536, 3072, ...)를 3D로 투영하고, 각 벡터를 코사인 유사도가 가장 높은 이웃과 연결합니다. 모든 계산은 Rust에서 합니다. 이어서 `queryCosineSimilar`는 원래 차원에서 계산한 정확한 코사인 유사도를 반환합니다. 문서·이미지 임베딩, 클러스터, 최근접 이웃을 눈으로 탐색할 때 사용합니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/embeddings.html)

## 기본 사용법

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const dimensions = 1536; // 예: OpenAI text-embedding-3
const count = 1000;
const vectors = new Float32Array(count * dimensions); // 임베딩으로 채움

const stats = sdk.loadEmbeddings(vectors, {
  dimensions,
  projection: 'pca',
  kNeighbors: 4,
  similarityThreshold: 0.3,
});
console.log(`벡터 ${stats.nodeCount}개, 엣지 ${stats.edgeCount}개, ${stats.elapsedMs.toFixed(0)} ms`);

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  onNodeClick: (node) => {
    if (node) console.log(sdk.queryCosineSimilar(node.id, 5));
  },
});
sdk.fitToView();
sdk.render();
```

## 데이터 형식

`vectors`는 `N × dimensions`개 값을 행 순서로 담은 평탄한 `Float32Array` 하나입니다. 벡터 `i`는 `vectors[i * dimensions .. (i + 1) * dimensions)`를 차지하며 노드 `i`가 됩니다.

길이는 0이 아닌 `dimensions`의 배수여야 합니다. 아니면 `loadEmbeddings`가 `vectors length (<length>) must be a non-zero multiple of dimensions (<dimensions>)` 오류를 던집니다. `dimensions`는 정수로 내림하고 최소 3으로 올립니다.

임베딩을 불러오면 현재 그래프나 차트를 교체합니다. 그 결과는 일반 3D 그래프이므로 [3D 네트워크 그래프](./graph-3d)의 노드 메타데이터, 툴팁, 선택, 카메라, 힘 시뮬레이션을 모두 쓸 수 있습니다.

## 옵션

`loadEmbeddings(vectors, options: HighDimEmbeddingOptions)`:

| 옵션 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `dimensions` | `number` | (필수) | 벡터 차원 D |
| `projection` | `'pca' \| 'pca-umap' \| 'random-projection'` | `'pca-umap'` | R<sup>D</sup> → R<sup>3</sup> 차원 축소 방식 |
| `kNeighbors` | `number` | `5` | 벡터마다 연결할 가장 유사한 이웃 수 |
| `similarityThreshold` | `number` | `0.35` | 엣지를 만들 최소 코사인 유사도, [-1, 1] |
| `clusters` | `Uint16Array` | | 벡터별 클러스터 ID (길이 N). 생략하면 Rust가 원래 D차원 공간에서 spherical k-means를 실행 |
| `umapWarmupTicks` | `number` | `35` | `'pca-umap'`에서 실행할 힘 배치 warmup 단계 수 |
| `spaceRadius` | `number` | `85` | 목표 3D 경계 구의 반지름 |

반환값: `{ nodeCount, edgeCount, dimensions, elapsedMs }`. `elapsedMs`는 호출 전후로 잰 투영과 k-NN 시간입니다.

### 투영 방식

| 방식 | 설명 |
| --- | --- |
| `'pca'` | matrix-free power iteration으로 계산하는 주성분 분석 |
| `'pca-umap'` | PCA 후 k-NN 그래프 위에서 힘 배치를 `umapWarmupTicks` 단계 실행 |
| `'random-projection'` | Johnson–Lindenstrauss 무작위 투영 |

## 유사도 질의

```ts
const top = sdk.queryCosineSimilar(0, 5);
// [{ nodeId: 812, cosineSimilarity: 0.8731, label: 'doc-0812' }, ...]
```

- `queryCosineSimilar(nodeId, topK = 8)`는 `CosineSimilarityMatch[]`(`nodeId`, `cosineSimilarity`, `label`)를 반환합니다. 3D 투영이 아니라 원래 R<sup>D</sup> 공간에서 정확하게 계산합니다. `cosineSimilarity`는 소수점 4자리로 반올림하고, `label`은 노드 메타데이터에서 가져옵니다(없으면 `Node #<id>`).
- `embeddingDimension()`은 현재 D를 반환합니다. 데이터를 3D 좌표로 불러왔다면 `0`입니다.

툴팁, 검색, 유사도 결과를 읽기 쉽게 하려면 `setNodeMetadata`로 라벨을 붙이세요.

```ts
sdk.setNodeMetadata(Array.from(topicIds, (topic, i) => ({
  label: `doc-${String(i).padStart(4, '0')}`,
  category: TOPICS[topic],
})));
```

## 합성 테스트 데이터

`Charturbo.generateSyntheticHighDimEmbeddings(nodeCount, dimensions, clusterCount = 8, seed = 42)`는 `{ vectors, clusters }`를 반환합니다. `clusterCount`개의 원형 벡터 주위에 모인 정규화된 벡터로, 차원과 설정을 시험할 때 씁니다.

```ts
const { vectors, clusters } = Charturbo.generateSyntheticHighDimEmbeddings(800, 768, 6);
sdk.loadEmbeddings(vectors, { dimensions: 768, projection: 'pca', clusters });
```

## 참고

- 벡터는 투영 전에 L2 정규화하므로 방향만 의미가 있습니다. 엔진은 정확한 유사도 질의를 위해 정규화한 사본(`N × D`개의 32비트 float)을 보관합니다.
- 엔진은 유한하지 않은 값(`embedding vectors must be finite numbers (no NaN / Infinity)`)과 길이가 N이 아닌 `clusters` 배열(`clusters slice length must match vector count N`)도 거부하며, `loadEmbeddings`는 이 메시지로 예외를 던집니다.
- 노드를 클릭하면 그 노드의 k-NN 엣지를 강조합니다(`highlightNeighborsOnClick`, 기본 `1`).

## 함께 보기

- [3D 네트워크 그래프](./graph-3d)
- [툴팁과 hover](../guide/tooltips)
- [성능](../guide/performance)
