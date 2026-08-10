# 局所知覚下でのエージェント障害物回避・経路探索: 既存研究・実装パターン調査

調査日: 2026-08-11
スコープ: 「絶対位置を知らず、視界内の相対位置・相対速度しかわからない」制約下でのboid/群ロボットの障害物回避手法。地形生成アルゴリズム自体は対象外（別サブエージェント担当）。

## 1. Reynolds boidsにおけるobstacle avoidance / wall following

Craig ReynoldsのオリジナルBoids(1986)は separation / alignment / cohesion の3ルールのみで、障害物回避は含まれていなかった。障害物回避は後続の "Steering Behaviors" フレームワークで追加の独立したsteering behaviorとして定式化された。

- Reynoldsの1999年GDC論文 "Steering Behaviors For Autonomous Characters" が、seek/flee, pursuit/evasion, wander, arrival, **obstacle avoidance**, containment, **wall following**, path following, flow field following といった一連のsteering behaviorを体系化した。[Steering Behaviors For Autonomous Characters (red3d.com)](https://www.red3d.com/cwr/steer/gdc99/) / [PDF](https://www.red3d.com/cwr/papers/1999/gdc99steer.pdf)
- **Obstacle avoidanceの具体的な計算方法（重要・本プロジェクトに直結）**: キャラクター自身のローカル座標系（自分の前方＝forward軸）で計算する。各障害物の中心座標をローカル座標系に変換し、forward成分を0にして側面-上部平面へ投影 → 2D距離を求める。この投影距離が「自分の半径＋障害物の半径」より小さければ衝突コースとみなす。複数の障害物候補から最も近い（最も脅威度が高い）ものを選び、その側面投影方向を反転させた向きへ操舵力を加える。**この手法は完全に相対座標・ローカル座標系だけで完結しており、絶対位置を一切使わない**——本プロジェクトの「boidは自分の速度と視界内の相対位置しか知らない」という制約と自然に整合する設計。出典: [red3d.com/cwr/steer/gdc99/](https://www.red3d.com/cwr/steer/gdc99/)（WebFetchで本文の該当セクションを確認済み）
- Wall followingは「壁面上の局所的な予測位置を表面に投影し、その投影点をオフセットした先をシーク目標にする」という、これもローカルな幾何計算のみで完結する手法。
- 複数behaviorの合成: 単純な加重和（summing）と、優先度に基づくdither（prioritized dither、危険度が高い behavior を優先して他を間引く）の両方が実用上使われてきた。boidのflockingルールにobstacle avoidanceを足す場合も同様の合成方法が使われる。出典: 同上、[Flocking and Steering Behaviors (CMU講義スライド)](https://www.cs.cmu.edu/afs/cs/academic/class/15462-s10/www/lec-slides/Lecture24_flocking.pdf)
- 拡張例: predictive obstacle avoidance（未来位置を予測して回避）とgoal-seekingを組み合わせた拡張が複数の研究で行われている。出典: [Boids obstacle avoidance wall following search summary](https://www.doc.ic.ac.uk/~nuric/posts/ai/boids/)

## 2. 群ロボティクスにおける局所センサーベースの障害物回避

### Artificial Potential Field (APF)法

最も古典的かつ広く使われる手法。障害物を反発力源、ゴールを引力源としてポテンシャル場を構成し、ロボットは合成力のベクトル方向に移動する。反発力はレーザーレンジファインダー等のローカルセンサー読み取り値から直接計算できるため、絶対位置マップ不要で局所知覚のみで動作可能。

- [Obstacle avoidance algorithm for swarm of quadrotor UAV using artificial potential fields (IEEE)](https://ieeexplore.ieee.org/document/8228246/) — スウォームUAVへのAPF適用例
- [Localized Path Planning for Mobile Robots Based on a Subarea-Artificial Potential Field Model (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11175262/)
- 群ロボティクス版のバリエーションとして、隣接ロボット・障害物・目標参照点それぞれに対する仮想バネ-ダンパ力を合成し、群形状を保ちながら軌道を動的調整する手法もある。

### Vector Field Histogram (VFH)系

Borenstein & Koren (1991) が提案。センサーからの距離データを2Dヒストグラムグリッドに蓄積し、それを1次元の極座標ヒストグラム（各方向セクターの障害物密度）に圧縮、密度の低い方向を選んで操舵する。APFより局所的な振動・トラップに強いとされる。

- 原論文PDF: [FAST OBSTACLE AVOIDANCE FOR MOBILE ROBOTS (CMU, Borenstein & Koren)](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_VFHisto.pdf)
- 発展形: **VFH+**（ロボットの形状・動力学を考慮）、**VFH\***（候補方向についてA\*探索で先読みし、純粋にローカルなVFHが陥りがちな行き詰まりを回避）、**3D-VFH**（UAV向け3D拡張）。VFH\*は「純粋にローカルな障害物回避アルゴリズムが問題を起こす状況」に対処するために先読み探索を組み合わせた点が本プロジェクトの検討に示唆的。出典: [VFH*: Local Obstacle Avoidance with Look-Ahead Verification (CMU)](https://www.cs.cmu.edu/~iwan/papers/vfhstar.pdf)
- 確率版 p-VFH は群ロボティクス・未知環境向けに拡張されている。出典: [swarm robotics local sensing 検索結果](https://ieeexplore.ieee.org/document/8228246/) 経由の関連文献

### Borenstein自身によるAPFの限界批判

VFHの開発者Borenstein自身が、APF法固有の限界（振動、狭い通路での不安定化、局所的トラップ）を論じた論文がある。局所反発力ベース手法を評価する上での一次情報として重要。
- [Potential Field Methods and Their Inherent Limitations for Mobile Robot Navigation (CMU, Borenstein)](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_potential_field_limitations.pdf)

## 3. 「離散障害物オブジェクト」vs「連続密度場・方向要約情報」の表現方式

2つの実装パターンが既存事例で明確に区別できる:

**(a) 離散オブジェクト方式**: 各障害物を個別の幾何オブジェクト（円・多角形など）として視界内に列挙し、各オブジェクトごとに相対位置・半径から回避ベクトルを計算する。Reynoldsのsteering behaviors（上記1章）、occupancy grid（セルごとに占有確率を持つ格子地図）がこの系統。
- [Occupancy Grids: A Stochastic Spatial Representation for Active Robot Perception](https://www.researchgate.net/publication/238983085_Occupancy_Grids_A_Stochastic_Spatial_Representation_for_Active_Robot_Perception)

**(b) 連続密度場・方向要約方式**: 個々の障害物を区別せず、方向ごとの「密度」や「危険度」に要約したヒストグラム/場として扱う。VFHの極座標ヒストグラムがこの典型。より高度な例では、障害物・壁・危険境界を「高密度な仮想領域」として表現し、拡散方程式ベースで安全距離を調整する「density field」手法も報告されている（ロボット同士の混雑度もdensity fieldとして統一的に扱う例）。
- [Physics-Informed Modeling and Control of Emergent Behaviors in Robot Swarms (arXiv)](https://arxiv.org/pdf/2606.01597)

**実装上のトレードオフ（今回集めた情報からの示唆、一次情報からの直接引用ではなく調査者の整理）**: 離散オブジェクト方式は障害物数に比例した計算（各boidが視界内の各障害物とペア判定）になり、障害物が疎であれば軽量。密度場・ヒストグラム方式は障害物数によらず「方向ビン数」に比例した固定コストになるため、障害物が密集する地形では有利になりうるが、量子化誤差や解像度依存のトレードオフを持つ。

## 4. 計算量のスケーリング特性

- 多数エージェント×多数障害物のシミュレーションは、素朴な実装では各エージェントが他の全エージェント/障害物をチェックするため計算量がO(N²)的に増大する。これを緩和する定番手法は空間分割（spatial hashing / グリッド分割）による近傍探索の高速化。出典: [boid simulation obstacle avoidance computational complexity 検索結果](https://medium.com/@arnav04verma/emergent-intelligence-at-scale-simulating-drone-swarms-with-boids-force-fields-and-adaptive-3ac5930f5c6e) 等の複数文献
- VFHは「ヒストグラムグリッド→極座標ヒストグラム」という2段階のデータ削減により、センサー数・障害物点数が増えても最終的な意思決定コストは方向セクター数に依存する定数的な計算量に抑えられる設計になっている。出典: [Borenstein & Koren VFH原論文](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_VFHisto.pdf)
- 群ロボティクス分野では「スケーラビリティ（群サイズが増えても計算量が破綻しないこと）」自体が設計目標として明示的に語られる。出典: [swarm robotics scalability 検索結果](https://medium.com/@arnav04verma/emergent-intelligence-at-scale-simulating-drone-swarms-with-boids-force-fields-and-adaptive-3ac5930f5c6e)

## 5. 既知の失敗パターン（本プロジェクトにとって最重要な反証情報）

局所知覚のみでの障害物回避は、原理的に解けない・行き詰まるケースが複数報告されている。

- **Local minima問題（APF法の代表的欠陥）**: 引力と反発力の合成ベクトルがゼロになる点にロボットが捕捉され、ゴールに到達できないまま停止する。特にU字型の凹型障害物の内側で発生しやすい（「trap situation」と呼ばれる）。出典: [The Bulldozer Technique: Efficient Elimination of Local Minima Traps for APF-Based Robot Navigation (arXiv)](https://arxiv.org/pdf/2512.23672)、[A new technique to escape local minimum in artificial potential field based path planning (Springer)](https://link.springer.com/article/10.1007/BF02982426)、[Virtual local target method for avoiding local minimum in potential field based robot navigation (PubMed)](https://pubmed.ncbi.nlm.nih.gov/12765277/)
- **狭い通路での振動・不安定化**: ロボットが通路中心からずれると、片側の反発力で反対側へ押し戻され、慣性でオーバーシュートしてまた反対側の反発力を受け、という振動が発散することがある。出典: Borenstein & Koren, [Potential Field Methods and Their Inherent Limitations](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/integrated1/borenstein_potential_field_limitations.pdf)
- **対策として提案されている手法**: harmonic potential field（凹型障害物周りを渦なく流れるよう場の形状を数学的に設計）、subgoal法（障害物周辺に中間目標点を生成）、virtual obstacle法（局所解の位置に仮想障害物を追加して押し出す）、backfilling（検出した局所解のポテンシャル値を人為的に引き上げてトラップとして機能しなくする）、VFH\*のような先読み探索の併用。
- **純粋反応型（reactive）手法一般の限界**: ORCA等の反応型衝突回避は計算効率が良く相互性の仮定下で衝突回避を保証できるが、狭い通路でのデッドロックが起きやすいと報告されている。出典: [reactive navigation deadlock 検索結果](https://arxiv.org/html/2605.15782)

これらは全て「本プロジェクトのboidが局所知覚（相対位置のみ）で地形障害物を回避する設計にした場合、CLAUDE.mdに記録されている過去のfrontier.tyシナリオのデッドロック（密集による板挟み状態）と同種の問題――U字型・凹型の地形やbottleneck状の狭い通路で、局所的な反発力だけでは行き詰まる／振動する既知パターンがある」ことを示す一次情報として重要。

## 限界・未解決

- Monte Carlo Boid Simulations with Obstacles (arXiv 2412.10420) は本プロジェクトのテーマに直結しそうなタイトルだったが、WebFetchがPDFのバイナリストリームをテキスト化できず、アブストラクトも簡潔すぎて具体的な知覚モデル・失敗パターンの記述を抽出できなかった。必要であれば人間が直接PDFを開いて確認することを推奨。
- Flocking with Distance Perception Obstacles Avoidance (technoarete.org, IJSEM) も同様にPDF本文の数式・アルゴリズム詳細を抽出できなかった（バイナリストリーム化）。タイトルからは「距離知覚（絶対位置なし）でのboid障害物回避」という本プロジェクトに最も近いテーマだが、詳細未確認。
- 「連続密度場」表現の一次事例として見つかった Physics-Informed Modeling and Control of Emergent Behaviors in Robot Swarms は比較的新しく（arXiv 2606.01597）、実装の枯れ具合や実績が不明。
- 2D Canvas・TypeScriptでの具体的な軽量実装コード例（本プロジェクトの技術スタックに直接近い一次情報）は今回のクエリ範囲では見つからなかった。ゲーム開発者向けのsteering behaviors解説記事（[slsdo.github.io](https://slsdo.github.io/steering-behaviors/)）はヒットしたが詳細未検証。
