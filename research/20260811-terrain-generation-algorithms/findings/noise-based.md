# ノイズベース地形生成手法の調査

調査目的: TypeScript + Canvas 2Dで実装する軽量2Dシミュレーションゲーム（boidベースのマルチエージェントシム）への地形生成導入の採用可否判断。

## 1. Perlin noise と Simplex noise の違い

### アルゴリズム的な差
- Perlin noiseは正方形グリッド（hypercube）の各頂点で勾配ベクトルを定義し、それらを補間する。次元nに対して頂点数は2^n個必要（2Dで4個、3Dで8個、4Dで16個）。
- Simplex noiseはKen Perlinが2001年に設計した後継アルゴリズムで、空間をn次元三角形（simplex）に分割する。simplexの頂点数はn+1個で済む。
- Simplex noiseは方向依存アーティファクト（axis-aligned artifacts）が少なく、より等方的（isotropic）な出力になる。
- 出典: [Simplex noise - Wikipedia](https://en.wikipedia.org/wiki/Simplex_noise), [Perlin Noise: Implementation, Procedural Generation, and Simplex Noise](https://garagefarm.net/blog/perlin-noise-implementation-procedural-generation-and-simplex-noise)

### 計算量
- Perlin noise: O(n · 2^n)（nは次元数）
- Simplex noise: O(n²)
- 2D程度の低次元では差は大きくないが、3D以上（アニメーション用に時間軸を第3次元として使う等）では顕著にSimplexが有利になる。
- 出典: [Simplex noise - Wikipedia](https://en.wikipedia.org/wiki/Simplex_noise)

### 特許状況
- Simplex noiseの3D以上でのテクスチャ合成実装は米国特許 US6,867,776（"Standard for perlin noise"）でカバーされていたが、**2022年1月8日に失効済み**。現在は自由に利用可能。
- 出典: [US6867776B2 - Standard for perlin noise - Google Patents](https://patents.google.com/patent/US6867776B2/en), [Godot Proposals discussion](https://github.com/godotengine/godot-proposals/discussions/5007)

### 生成品質
- Simplex noiseの方が高次元でのアーティファクトが少なく品質が高いとされるが、2D限定であればPerlin noiseとの視覚的差は実用上小さい。
- 出典: [Simplex Noise vs Perlin Noise: When and Why - PulseGeek](https://pulsegeek.com/articles/simplex-noise-vs-perlin-noise-when-and-why/)

## 2. 高さ場（heightmap）としての使い方とfBm（オクターブ合成）

- 基本手法: マップ上の各点(x, y)についてノイズ値（0.0〜1.0または-1〜1）を計算し、そのまま標高値として使う。「50行以下のコードで地図生成が可能」というくらいシンプル。
- fBm（fractional Brownian motion、"turbulence"とも呼ばれる）: 複数のオクターブ（＝異なる周波数・振幅のノイズレイヤー）を重ね合わせて自己相似的なディテールを作る。典型的な振幅の重み付けは `[1, 1/2, 1/4, 1/8, 1/16, …]`。
- 主要パラメータ:
  - **オクターブ数**: 重ねるノイズレイヤーの数。多いほど細部が増えるが計算コストも線形に増加。
  - **lacunarity（空隙度）**: オクターブごとの周波数の増加率。2.0がほぼ全ケースで良い値とされる（周波数が毎オクターブ倍になる）。
  - **persistence（persistence gain）**: オクターブごとの振幅減衰率。大きいほど「粗い（ゴツゴツした）」ノイズになる。
- 標高の再分布（redistribution）: `elevation = Math.pow(e, exponent)` のような累乗変換で山を急峻に、谷を平坦にできる。指数3〜5が効果的とされる。
- 各オクターブは異なるシード/オフセットでサンプリングし、レイヤー間の相関を避けるのが重要。
- 出典: [Red Blob Games: Making maps with noise functions](https://www.redblobgames.com/maps/terrain-from-noise/), [Procedural Generation Using Fractional Brownian Motion - Medium](https://medium.com/@logan.margo314/procedural-generation-using-fractional-brownian-motion-b35b7231309f), [The Book of Shaders: Fractal Brownian Motion](https://thebookofshaders.com/13/)

## 3. バイオーム生成（複数ノイズレイヤーの組み合わせ）

- 単一の標高値だけでは地形が単調な同心円/バンド状になってしまう。標高だけで判断すると「隣接すべきでないバイオームが隣接する」問題が起きる。
- 解決策: 独立した2つ目のノイズレイヤー「moisture（湿度）」を追加し、標高×湿度の2軸でバイオームを決定する（Red Blob Gamesは生態学者ロバート・ホイッテーカーのバイオーム分類を参考にすることを推奨）。
- より発展的な実装（Minecraft型）: 複数の3Dノイズマップで温度・湿度・continentalness（海岸からの距離）・erosion（起伏の激しさ）・weirdness（変種判定用）などの気候パラメータを定義し、各バイオームがこれらパラメータの理想範囲を持つ方式もある。
- 実装例では高さ・湿度・温度に加えてSimplex Noiseを組み合わせ、Whittaker図（植生分類図）ベースでバイオームを割り当てる手法も報告されている（例: 高標高＋高湿度＋低温→雪原、海抜近く＋高湿度＋高温→熱帯雨林）。
- 閾値のチューニングは避けられない作業として明記されている（"these thresholds will need tuning"）。
- 出典: [Red Blob Games: Making maps with noise functions](https://www.redblobgames.com/maps/terrain-from-noise/), [How Minecraft Terrain Generation Works](https://cybrancee.com/blog/how-minecraft-terrain-generation-works/), [Comparative Analysis of Procedural Planet Generators (arXiv)](https://arxiv.org/pdf/2510.24764)

## 4. JS/TypeScriptでの実装コスト

### 自前実装の難易度
- 2D Perlin/Simplex noiseの基本実装自体は数十〜100行程度で書けるレベル（勾配テーブル、フェード関数、補間）。アルゴリズムの理解さえあれば決して難しくない。
- ただしシード管理・permutationテーブルの生成・境界のラップアラウンドなど細部を正しく実装するには一定の注意が必要。

### 既存ライブラリ
- **simplex-noise (jwagner/simplex-noise.js)**: TypeScriptで書かれ型定義も含む。依存関係ゼロ（シード指定時のみalea等のPRNGが必要）。ミニファイ+gzip後で約2KB。tree-shakeable。npmで配布。
  - パフォーマンス: `noise2D()` が約7000万〜7300万回/秒（Ryzen 5950X環境）。1呼び出し約20ナノ秒。
  - 出典: [jwagner/simplex-noise.js - GitHub](https://github.com/jwagner/simplex-noise.js/), [simplex-noise on libraries.io](https://libraries.io/npm/simplex-noise)
- 他の選択肢として `fast-simplex-noise`、`open-simplex-noise` などもあるが、ベンチマーク上は `simplex-noise` の方が高速（`fast-simplex-noise`比で約8倍）。
- 出典: [fast-simplex-noise - npm](https://www.npmjs.com/package/fast-simplex-noise)

## 5. Canvas 2Dでのパフォーマンス特性

- ノイズ関数自体の呼び出しは非常に高速（数千万回/秒オーダー）だが、ボトルネックは「Canvas 2Dへのピクセル書き込み」側になりやすい。
- 典型的な実装は各ピクセル座標についてノイズをサンプリングし色を設定するが、「画面全体のピクセルを毎フレーム更新するのは遅くなる」との指摘がある（noise.js自体は1000万クエリ/秒でも実現できるにも関わらず）。
- 実務上の指針: 初回生成時（マップ生成の1回きりの処理）であれば数百×数百〜1000×1000セル程度は問題にならない規模感。毎フレーム再生成するようなユースケース（リアルタイムアニメーションノイズをCanvas全面に適用等）は避け、GPU（WebGL/GLSLシェーダ）に切り替えるべきとされている。
- 本プロジェクトの用途（boidシミュレーションの背景地形として、ワールド生成時に1回だけheightmapを計算しキャッシュする）であれば、Canvas 2Dのボトルネックにはならないと推測される。ただし本調査では具体的な「何セルまでなら何msで完了するか」という定量ベンチマークは見つけられなかった（限界参照）。
- 出典: [Perlin Noise on JavaScript Canvas - Snippet Zone](https://snippet.zone/2021/12/16/perlin-noise-on-javascript-canvas/), [josephg/noisejs - GitHub](https://github.com/josephg/noisejs)

## 6. パラメータ調整の難しさ

- オクターブ数・lacunarity・persistence・redistribution指数など、パラメータの数自体は少なくない（4〜5個）が、それぞれの効果は視覚的に直感把握しやすい部類（"周波数を倍にする"、"ゴツゴツ度を上げる"等）。
- 一方で、バイオーム分類に使う閾値（標高X以上かつ湿度Y以上ならタイガ、等）は自明な初期値がなく、生成物を目視しながら試行錯誤でチューニングする必要がある。Red Blob Gamesも「閾値はチューニングが必要」と明言。
- 単純な一様fBmでは「山だらけ」か「平坦だらけ」の両極端になりやすく、「山と平地が自然に混在する地形」を作るのは難度が上がる（ドメインワーピングや複数ノイズの合成など追加テクニックが必要になりがち）。
- 出典: [Red Blob Games: Making maps with noise functions](https://www.redblobgames.com/maps/terrain-from-noise/), [Noise for terrains - Learn Procedural Generation](https://aparis69.github.io/LearnProceduralGeneration/terrain/procedural/noise_for_terrains/)

## 7. 離散的表現 vs 連続的表現への向き不向き

- ノイズは本質的に**連続値**を返す関数であり、「移動コストが連続的に変化する地形」（例: 標高が高いほど移動速度が落ちる、湿地は移動コストが高い等）との相性が良い。ノイズ値をそのままコスト関数の入力として使える。
- 「歩行不可の壁」のような**離散的な障害物**を表現する場合は、連続値に対して閾値処理（thresholding）を後付けする必要がある（例: `elevation > 0.8` を「山＝進入不可」とする）。この閾値処理自体は簡単だが、結果として生じる壁の形状はノイズの等高線任せになり、意図的なレベルデザイン（決まった形の迷路や通路）には向かない。
- Red Blob Gamesは「各セルの計算が独立している（local calculation）」ためノイズは並列化・無限生成に向くが、逆に「マップ上のどこも似たような表情になる」「複数の湖・河川ネットワークのようなグローバルな構造を作るのは苦手」という限界を明記している。
- 学術的な指摘: 単純な一様fBmは「山だらけ」か「平坦だらけ」の両極になりがちで、渓谷（valley）のような特定地形は作るのが難しい、または不可能に近い。侵食・河川・峡谷・火山のような複雑な地形特徴は、ノイズだけでは説得力のある表現が困難で、大がかりな後処理（post-processing）が必要になる。
- 結論（本調査からの示唆）: **連続的な移動コスト地形（例: 草原=速い、沼地=遅い、山=進入不可に近いコスト）を表現する用途には向いている。決まった形状の「壁」「通路」「拠点配置」のような意図的な離散構造が必要な用途にはノイズ単体では不向きで、後処理（閾値化＋補正、あるいは他手法との併用）が必要。**
- 出典: [Red Blob Games: Making maps with noise functions](https://www.redblobgames.com/maps/terrain-from-noise/), [Noise for terrains - Learn Procedural Generation](https://aparis69.github.io/LearnProceduralGeneration/terrain/procedural/noise_for_terrains/)

## 限界・未解決事項

- Canvas 2Dでの「具体的に何セル/何ピクセル規模まで何msで実用的か」という定量ベンチマークは見つけられなかった。ノイズ関数自体は数千万回/秒処理できるが、Canvas描画（putImageData等）側のコストを含めた実測データは今回のクエリでは未発見。本プロジェクトで採用する場合は簡易ベンチマークを自前で取ることを推奨。
- 「歩行不可の壁」的な離散構造とノイズ地形をどう自然に組み合わせるか（閾値化以外の具体的テクニック、例えばドメインワーピングやセルオートマトンとの併用）についての一次情報は、スコープ外（セルオートマトン洞窟生成・WFC・Voronoiは別サブエージェント担当）のため深掘りしていない。
