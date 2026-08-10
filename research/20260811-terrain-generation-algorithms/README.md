# 地形のランダム生成アルゴリズム: simple-boids-likeにどれを採用すべきか

## TL;DR

- 地形生成の主要アルゴリズムは大きく2系統に分かれる。**連続値を返す手法**
  （ノイズ）は「移動コストがなだらかに変化する地形」向き、**離散値を返す
  手法**（セルオートマトン、Wave Function Collapse）は「歩行不可の壁」向き。
  単一の手法で両方をきれいに表現するものは無い[^1][^2]。
- 岩・木のような個別オブジェクトの散布には**ポアソン円盤サンプリング**が
  定番で、実装コストが低く（自前実装で約80行）JS/TypeScript向けの成熟した
  npmパッケージも存在する[^3][^4]。
- boidの知覚モデル（絶対位置を持たず視界内の相対情報のみ）と最も自然に
  整合する障害物回避手法は、Craig Reynoldsのsteering behaviors流の
  **ローカル座標系ベースの回避計算**である。これは既存プロジェクトの設計
  制約とゼロから相性がよい[^5]。
- 一方、局所知覚のみでの障害物回避には**local minima問題**（凹型・U字型の
  地形内で身動きが取れなくなる）という既知の失敗パターンがある[^6]。
  本プロジェクトが`frontier.ts`で実際に踏んだ「密集による板挟み
  デッドロック」（`docs/roadmap.md`参照）と構造的に同種の問題である
  可能性が高い（推測: 一次情報が直接この対応関係を論じているわけではなく、
  両者の力学的構造が同じであることからの調査者の整理。詳細は後述）。

## 用語集（初出順）

- **ノイズ（Perlin/Simplexノイズ）** = 座標を入力すると滑らかに変化する
  疑似ランダム値を返す関数。地形の高さ・湿度などの連続値表現に使う。
- **fBm（fractional Brownian motion）** = 複数のノイズレイヤー（オクターブ）
  を重ね合わせて自己相似的なディテールを作る手法。
- **セルオートマトン** = グリッドの各セルが近傍セルの状態に基づいて次の
  状態を決めるルールを反復適用する手法。ここでは洞窟状の壁/床マップ生成
  に使う。
- **ポアソン円盤サンプリング** = 「最小距離以上離れた点だけを採用する」
  ことで密集や不自然な空白のない自然な点配置を作るサンプリング手法。
- **Wave Function Collapse (WFC)** = タイル間の隣接ルールに基づき、制約
  充足的にタイルマップを生成する手法。
- **Voronoi分割** = 平面上の種点集合から「どの種点に最も近いか」で領域を
  分割する手法。
- **バイオーム** = 標高・湿度などのパラメータの組み合わせで決まる地形の
  種別（草原・砂漠・雪原など）。
- **APF（Artificial Potential Field）** = 障害物を反発力、目標を引力として
  扱い、合成力の方向に移動する古典的な障害物回避手法。
- **VFH（Vector Field Histogram）** = センサー情報を方向ごとの密度
  ヒストグラムに要約し、密度の低い方向へ操舵する障害物回避手法。
- **local minima問題** = 引力と反発力が釣り合ってしまい、ゴールに到達
  できないまま動けなくなるAPF系手法の代表的な弱点。
- **Delaunay三角分割** = 点集合を、どの三角形の外接円にも他の点が
  含まれないように結んで三角形分割する手法。Voronoi分割と双対の関係にある。
- **Lloyd relaxation** = Voronoiの各セルの重心へ種点を移動して再分割を
  繰り返し、セル形状を均質化・平滑化する手法。
- **フラッドフィル** = 開始点から連結したセルだけを塗りつぶして特定する
  探索手法。セルオートマトン洞窟生成では、到達可能な最大連結領域だけを
  残し孤立領域を除去するのに使う。
- **三角分布** = 最頻値（ピーク）から離れるほど確率が直線的に減少する
  確率分布。Minecraftの鉱脈生成で深さごとの出現率制御に使われる。
- **spot noise** = 候補点を複数生成し、ノイズ関数によるスコアで採否を
  決める配置手法。Factorioの資源パッチ配置で使われる。
- **occupancy grid** = セルごとに「障害物が存在する確率」を持つ格子地図。
  離散オブジェクト方式の障害物表現の一種。

## 主要な発見

- **連続値手法と離散値手法は用途がはっきり分かれる。** ノイズは「移動
  コストのなだらかな変化」に向き、セルオートマトン・WFCは「歩行可否の
  2値判定」に向く。両立させたいなら組み合わせが前提になる[^1][^2]。
- **本プロジェクトの技術スタック（TS + Canvas 2D、小規模ワールド）では、
  どの手法も実装コスト・パフォーマンスの両面で現実的な選択肢になりうる**
  （下表の個別調査結果からの調査者による総合的な整理であり、この一般化
  自体を直接述べた一次情報があるわけではない）。ただしWFCだけはタイル
  セット設計コストと生成時間の非決定性という別種の重さを持つ[^7][^8]。
- **boidの障害物回避は、Reynoldsのsteering behaviors流のローカル座標系
  計算が本プロジェクトの知覚モデルと自然に整合する。** 一方でAPF系の
  局所反発力ベース手法には、本プロジェクトが既に経験した「密集による
  板挟みデッドロック」と同種のlocal minima問題が既知の弱点として存在する
  [^5][^6]。
- **地形とリソース配置を関連付ける「バイオーム的配置」は実装コストが
  低い一方、探索の面白さを削ぐリスクが指摘されている。** ノイズによる
  密度濃淡や例外バイオームの導入で緩和するのが定石[^9]。

## 詳細

### 地形表現の2大分類：連続値 vs 離散値

| 分類 | 代表アルゴリズム | 得意な表現 | 苦手な表現 |
|---|---|---|---|
| 連続値 | Perlin/Simplexノイズ＋fBm | 移動コストがなだらかに変化する地形（沼地は遅い、山は登りにくい等） | 意図した形状の「壁」「通路」 |
| 離散値（2値） | セルオートマトン洞窟生成 | 歩行可能/不可の2値マップ、有機的な洞窟形状 | 移動コストの濃淡表現 |
| 離散値（タイル） | Wave Function Collapse | タイル単位で整合の取れた構造物・通路 | 大陸・山脈のような大域的な自然地形 |
| 領域分割 | Voronoi分割 | バイオーム境界・縄張り・勢力圏の区切り | それ自体は壁を作らない、曲線的な境界には後処理が要る |
| 点配置 | ポアソン円盤サンプリング | 岩・木などの個別オブジェクトの自然な散布 | 面としての地形表現そのものには使わない |

今回参照したWFC・Voronoi分割・ノイズそれぞれの情報源において、
**単一の手法だけで「壁」と「連続地形」の両方を自然に表現するのは難しく、
組み合わせが実務上の定石**という同趣旨の指摘が見られた[^1][^2]（ただし
本調査で直接比較・言及したのはこの2件の情報源であり、業界全体での
コンセンサスを定量的に確認したものではない）。

### 各アルゴリズムの実装コスト・パフォーマンス比較

| 手法 | JS/TS実装コスト | 既存ライブラリ | パフォーマンス特性（本プロジェクト規模） | パラメータ調整の難所 |
|---|---|---|---|---|
| Perlin/Simplexノイズ＋fBm | 自前実装は数十〜100行。ライブラリ利用ならほぼゼロ | `simplex-noise`（TS対応・依存ゼロ・約2KB gzip）[^10] | ノイズ関数自体は極めて高速。ボトルネックはCanvas描画側になりうるが、初回生成時のみのキャッシュ利用なら問題にならないと推測される（定量ベンチマークは本調査では見つからなかった） | バイオーム閾値のチューニングは自明な初期値がなく試行錯誤が必要[^2] |
| セルオートマトン洞窟生成 | コア部分は数十行程度という報告あり[^11]。連結性検証（フラッドフィル）の追加分は経験的に+30〜50行程度と推測される（この加算分自体の一次データはなし） | 汎用npmパッケージは見当たらず、自前実装が前提の実例が確認された[^11] | O(セル数×反復回数)。本プロジェクト規模なら初回生成のみのコストとして軽量と推測される（定量ベンチマークは本調査では見つからなかった） | 孤立した非連結領域が生じやすく、フラッドフィル（到達可能な最大連結領域だけを残す後処理）による連結性検証が別途必要[^12] |
| ポアソン円盤サンプリング | Processing実装で約80行という報告あり[^3]（JS/TSでも構文的な近さから同程度の規模になると推測される、直接の実測報告ではない） | `poisson-disk-sampling`（週間DL約6,000〈調査時点〉、TS型定義あり）[^4] | O(N)。本プロジェクト規模（静的オブジェクト数十〜百）なら初回生成コストとして軽量[^3] | 密度パラメータ`r`をオブジェクト種別・領域ごとに調整する程度。バイオーム閾値・タイルセット設計と比べると調整項目は少ないと考えられる（本調査からの相対的な整理であり、直接比較した一次情報はない） |
| Wave Function Collapse | アルゴリズム自体（エントロピー選択＋制約伝播）はコード量として小〜中規模[^7]。ただし**隣接ルールを人手で定義するSimple Tiled Modelの場合、タイルセット設計が最大コスト**になる[^7]（サンプル画像から隣接規則を自動抽出するOverlapping Modelを使えば、この手動設計コストは回避できる） | 公式npm決定版は今回の調査では確認できず、非公式移植が複数存在する状態 | 初回生成のみなら問題ないが、**contradiction（あるセルの候補が0になり手詰まりする状態）発生時のバックトラックで生成時間が非決定的**になりうる[^8][^13] | タイル数が増えるほど隣接ルール定義が組み合わせ的に煩雑化（Simple Tiled Modelの場合）[^7] |
| Voronoi分割 | 自前実装は難易度が高いが**既存ライブラリが豊富** | `d3-delaunay`（Canvas 2D描画メソッド直結、内部でDelaunatorを使用）[^14] | Delaunatorの実測ベンチマーク: 一様分布10万点でdelaunator 82ms／旧d3-voronoi 972ms（約12倍）、100万点でdelaunator 1.07秒／旧d3-voronoi 15.04秒（約14倍）[^15]。本プロジェクト規模（数十〜数百点）なら数ミリ秒未満と推測される | 種点そのままだと境界が不自然に直線的。Lloyd relaxationで緩和できるが均質化とのトレードオフ[^16] |

### リソース配置との連携（バイオーム的配置）

Minecraft・Factorioともに「地形/バイオーム決定 → その上にリソースを
配置する」という2段階パイプラインを採用している[^17][^18]（Minecraft側の
[^17][^19]はMojang公式ドキュメントではなく、コミュニティによる解析に
基づくMinecraft Wikiの記述である点に注意）。

- **閾値/ルックアップテーブル方式**（標高×湿度などの複数ノイズレイヤーを
  組み合わせてバイオームを決定する、Red Blob Games流）が最も実装コストが
  低い[^2]。
- **密度関数ベース**（Minecraftの鉱脈生成: 鉱石種別を切り替えるtoggle
  ノイズ・鉱脈の輪郭を削るridgeノイズ・鉱石と充填材の比率を決めるgap
  ノイズの3種＋Y座標ごとの三角分布で出現確率を制御[^19]）や、
  **候補点＋適合性スコア
  方式**（Factorioのspot noise: 候補点をノイズ式でスコアリングし上位を
  採用、傾斜などの地形情報をスコアに反映[^18][^20]）は、より作り込んだ
  配置ができる一方、実装コストは上がる。
- 地形と資源を関連付けると、boidエージェントが「視界内の地形情報から
  資源の存在確率を推測する」という新しい知覚・戦略の余地を持てる。
  これは本プロジェクトの「相対情報のみで意思決定する」設計思想と相性が
  良い可能性がある（推測: 一次情報からの直接引用ではなく、収集した情報
  を踏まえた設計的示唆）。
- 一方、決定論的すぎる配置は「探索の面白さを削ぐ」という批判が指摘
  されている。対策として、ノイズによる密度濃淡・局所的な例外バイオーム・
  軽いランダム性の上乗せが挙げられている[^9]。

### 知覚モデルとの統合：boidの障害物回避

このプロジェクトの核となる制約は「boidは絶対位置を持たず、視界内の
相対位置・相対速度しか知覚できない」こと（`CLAUDE.md`参照）。地形の
障害物をこの制約の下でどう回避させるかは、地形生成アルゴリズムの選定
そのものとは別の、しかし密接に関わる論点である。

- Craig Reynoldsのsteering behaviors（1999年GDC論文）における
  obstacle avoidanceは、障害物中心をboid自身の**ローカル座標系**に
  変換して側面投影距離を判定する手法で、**絶対位置を一切使わない**。
  本プロジェクトの知覚モデルと構造的に整合する[^5]。
- ただし、Reynolds流の回避も本質的には「局所的な反発力・操舵力のベクトル
  合成による反応的な操舵」という点でAPFと同系統の仕組みである。凹型・
  入り組んだ地形では、Reynolds流の回避も後述するAPF系と同様の
  local minima的な行き詰まりを起こしうると考えられる（推測: 本調査では
  Reynolds流steering behaviors自体のlocal minima脆弱性を直接論じた
  一次情報は見つからなかった。この推測は両手法が共通の力学的構造
  ［局所ベクトルの合成］を持つことからの類推であり、断定はできない）。
- 群ロボティクス分野の古典的手法であるArtificial Potential Field（APF）
  も、反発力をセンサーの局所読み取り値から直接計算できるため絶対位置
  マップを必要としない[^21]。
- しかし、APF系の局所反発力ベース手法には**local minima問題**（凹型・
  U字型障害物の内側でゴールへの引力と壁からの反発力が釣り合い、
  身動きが取れなくなる）という既知の失敗パターンがある[^22][^23][^24]。
  Vector Field Histogram (VFH) はこれを緩和するために方向ヒストグラムへ
  情報を要約する手法として提案された[^25]が、それでも純粋にローカルな
  VFHは行き詰まりうるため、先読み探索を加えたVFH\*が発展形として存在する
  [^26]。
- **この失敗パターンは、本プロジェクトが`frontier.ts`で既に経験した
  デッドロック（`docs/roadmap.md`に記録: 密集した仲間からの分離力に
  押されて特定の1点にたどり着けず、燃料切れで全滅する板挟み状態）と
  構造的に同種の問題である**（推測: 一次情報が直接この対応関係を論じて
  いるわけではなく、両者の力学的構造が同じであることからの調査者の
  整理）。地形の凹部・狭い通路を導入する場合、同種のデッドロックが
  再発する可能性を設計段階で織り込む必要がある。
- 障害物の見せ方には「離散オブジェクトとして個別に列挙する」方式
  （Reynolds流、occupancy grid）と「方向ごとの密度・危険度に要約する」
  方式（VFHの極座標ヒストグラム）の2系統があり、前者は障害物数に、
  後者は方向ビン数に比例した計算コストになる[^25][^27]。

## 矛盾・未解決

- ノイズ・セルオートマトン・ポアソン円盤いずれについても、「Canvas 2Dで
  具体的に何セル/何点までなら何msで完了するか」という**定量的な実測
  ベンチマーク**の一次情報は見つからなかった。計算量オーダーからの
  理論的推定にとどまる。Voronoi分割（Delaunator）のみ、ライブラリ自身の
  README内ベンチマーク表という一次情報から「10万点で82ms」という具体的な
  数値が見つかり、spot checkでも数値の一致を確認できた（詳細は引用[^15]参照）。
- WFCの「JS/TypeScript向け公式実装の決定版」は確認できなかった。採用を
  検討する場合は候補ライブラリを個別に精査する必要がある。
- 「地形と資源配置を関連付けるべきか」について、査読済み研究やA/Bテスト
  のような定量的なプレイテスト比較は見つからなかった。開発者個人の考察
  記事レベルの情報にとどまる。
- boidの知覚モデル（絶対位置なし）に最も近いテーマの論文2本（Monte Carlo
  Boid Simulations with Obstacles、Flocking with Distance Perception
  Obstacles Avoidance）はPDF本文の自動抽出に失敗し、内容を確認できて
  いない。

## 限界

- 調査は日本語・英語の情報源を対象とし、深さ「deep」（5サブエージェント
  ×クエリ上限15）で実施したが、査読付き学術論文への到達は一部（VFH系・
  local minima問題）にとどまり、多くはゲーム開発者の技術ブログ・解説
  記事レベルの二次情報に依拠している。
- 「本プロジェクトへの示唆」「推測」とラベル付けした箇所は、収集した
  事実からの調査者の論理的な橋渡しであり、一次情報がその対応関係を
  直接論じているわけではない。
- 実装後の実測パフォーマンス検証は本調査の範囲外。上記「矛盾・未解決」
  に記載の通り、Canvas 2Dでの具体的な数値は自前でベンチマークを取る
  ことを推奨する。
- ノイズ（Perlin 1985年発表）とポアソン円盤サンプリング（Bridson 2007年
  発表）は、いずれも基礎アルゴリズムの原論文そのものではなく、解説記事
  （Red Blob Games、Sighack）を主な情報源としている。原論文の数式・
  擬似コードの一字一句までは本調査では確認していない。

## 引用

- [^1]: [Wave Function Collapse Explained – BorisTheBrave.Com](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/) — WFCの隣接制約は局所的にしか効かず、大陸・山脈のような大域構造は自然には生まれないと指摘
- [^2]: [Red Blob Games: Making maps with noise functions](https://www.redblobgames.com/maps/terrain-from-noise/) — ノイズは連続値の地形表現に向き、閾値チューニングが必要と明記
- [^3]: [Sighack: Poisson Disk Sampling in Processing](https://sighack.com/post/poisson-disk-sampling-bridsons-algorithm) — Bridsonのアルゴリズムの実装解説、約80行の実装規模とO(N)の近傍探索
- [^4]: [poisson-disk-sampling – npm](https://www.npmjs.com/package/poisson-disk-sampling) — 週間DL約6,000、TypeScript型定義対応のnpmパッケージ
- [^5]: [Steering Behaviors For Autonomous Characters – Reynolds (red3d.com, GDC99)](https://www.red3d.com/cwr/steer/gdc99/) — obstacle avoidanceをローカル座標系（forward軸基準）で計算する手法を提示
- [^6]: [Potential Field Methods and Their Inherent Limitations for Mobile Robot Navigation – Borenstein (CMU)](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_potential_field_limitations.pdf) — APF法のlocal minima・狭い通路での振動問題を論じた文献。著者Borensteinは[^25]のVFH原論文の共著者でもあり、APF自体の批判的検証者という立場（APF自体の原提案はKhatib(1986)によるもので、本調査ではKhatib自身の原論文は対象に含めていない）
- [^7]: [Wave Function Collapse: Master Procedural Dungeon Generation – DrCodes](https://drcodes.com/posts/wave-function-collapse-master-procedural-dungeon-generation) — タイルセット設計（隣接ルールの手動列挙）が実装上最大のコストと指摘
- [^8]: [Procedural Generation with Wave Function Collapse – gridbugs.org](https://www.gridbugs.org/wave-function-collapse/) — 大規模生成でのcontradiction・バックトラックによる非決定的な生成時間の問題を指摘
- [^9]: [Making Procedural World Gen Interesting – Little Martian](https://little-martian.dev/21-03-19-interesting-world-gen/) — 決定論的すぎる手続き生成が探索の面白さを削ぐ問題と、密度濃淡・例外バイオームによる緩和策
- [^10]: [jwagner/simplex-noise.js – GitHub](https://github.com/jwagner/simplex-noise.js/) — TypeScript対応・依存ゼロ・約2KB(gzip)のsimplex noise実装
- [^11]: [Procedural Dungeon Generation: Cellular Automata – jrheard's blog](https://blog.jrheard.com/procedural-dungeon-generation-cellular-automata) — 汎用ライブラリを使わず自前でセルオートマトン洞窟生成を実装した実例
- [^12]: [Cellular Automata Method for Generating Random Cave-Like Levels – RogueBasin](https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels) — 孤立した非連結領域が生じやすい問題とフラッドフィル対策
- [^13]: [mxgmn/WaveFunctionCollapse (原実装README)](https://github.com/mxgmn/WaveFunctionCollapse) — 原著者による「妥当なタイル選択ならバックトラックは稀」という言及と、理論上の非決定性
- [^14]: [d3/d3-delaunay – GitHub](https://github.com/d3/d3-delaunay) — Canvas 2Dへの直接描画メソッドを持つ高速Voronoi/Delaunayライブラリ
- [^15]: [mapbox/delaunator – GitHub](https://github.com/mapbox/delaunator) — 「Benchmark results against other Delaunay JS libraries」表の実測値（Macbook Pro Retina 15" 2017, Node v10.10.0測定）: uniform 10万点でdelaunator 82ms／d3-voronoi 972ms、uniform 100万点でdelaunator 1.07秒／d3-voronoi 15.04秒。spot check済み（WebFetchで数値一致を確認）
- [^16]: [Procedural Terrain Generation With Voronoi Diagrams – squeakyspacebar](https://squeakyspacebar.github.io/2017/07/12/Procedural-Map-Generation-With-Voronoi-Diagrams.html) — 種点そのままだと境界が不自然に直線的になる問題とLloyd relaxationによる緩和
- [^17]: [Minecraft Wiki: World generation](https://minecraft.wiki/w/World_generation) — Generation（地形/バイオーム決定）→Population（フィーチャー配置）の2段階パイプライン
- [^18]: [Friday Facts #258 - New autoplace – Factorio](https://factorio.com/blog/post/fff-258) — spot noiseによる候補点＋適合性スコア方式の資源パッチ配置、傾斜との連動
- [^19]: [Noise router – Minecraft Wiki](https://minecraft.wiki/w/Noise_router) — 鉱脈生成のtoggle/ridge/gapノイズとY座標三角分布による出現確率制御
- [^20]: [factorio-data: resource-autoplace.lua](https://github.com/wube/factorio-data/blob/master/core/lualib/resource-autoplace.lua) — Factorioの資源配置ロジックの実装ソース
- [^21]: [Obstacle avoidance algorithm for swarm of quadrotor UAV using artificial potential fields – IEEE](https://ieeexplore.ieee.org/document/8228246/) — 群ロボティクスへのAPF適用例、局所センサー情報のみでの動作
- [^22]: [The Bulldozer Technique: Efficient Elimination of Local Minima Traps for APF-Based Robot Navigation – arXiv](https://arxiv.org/pdf/2512.23672) — APF法のlocal minima問題への対策手法
- [^23]: [A new technique to escape local minimum in artificial potential field based path planning – Springer](https://link.springer.com/article/10.1007/BF02982426) — local minima問題の学術的定式化と回避技術
- [^24]: [Virtual local target method for avoiding local minimum in potential field based robot navigation – PubMed](https://pubmed.ncbi.nlm.nih.gov/12765277/) — virtual local target法によるlocal minima回避
- [^25]: [FAST OBSTACLE AVOIDANCE FOR MOBILE ROBOTS – Borenstein & Koren (CMU, VFH原論文)](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_VFHisto.pdf) — Vector Field Histogramの原論文、方向密度ヒストグラムによる障害物回避
- [^26]: [VFH*: Local Obstacle Avoidance with Look-Ahead Verification – CMU](https://www.cs.cmu.edu/~iwan/papers/vfhstar.pdf) — 先読み探索を組み合わせたVFHの発展形
- [^27]: [Occupancy Grids: A Stochastic Spatial Representation for Active Robot Perception – ResearchGate](https://www.researchgate.net/publication/238983085_Occupancy_Grids_A_Stochastic_Spatial_Representation_for_Active_Robot_Perception) — セルごとの占有確率を持つ格子地図による離散的な障害物表現

## メタ情報

- 調査日: 2026-08-11
- 深さ: deep（5サブエージェント並列、各クエリ上限15）
- クエリ型: Breadth-first（独立5サブトピック）
- 主要な検索クエリ例: "perlin noise vs simplex noise", "fbm terrain generation",
  "cellular automata cave generation algorithm", "poisson disk sampling
  object placement game", "wave function collapse algorithm explained",
  "voronoi diagram biome generation game", "minecraft terrain generation
  biomes", "factorio resource placement algorithm", "boids obstacle
  avoidance steering behavior", "potential field method local minima"
- 棄却した情報源: SEOまとめ記事、出典不明の「procgenアルゴリズムまとめ」
  ブログ（各サブエージェントが一次情報・定評ある解説記事を優先した結果、
  個別のURLとしては記録していない）
