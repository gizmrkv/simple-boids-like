# Wave Function Collapse と Voronoi分割 — 地形生成手法調査

調査目的: TypeScript + Canvas 2Dの軽量boidシムに地形生成を追加する際の採用可否判断。

## 1. Wave Function Collapse (WFC)

### 基本アルゴリズム

考案者はMaxim Gumin（2016年公開）。制約充足（constraint satisfaction）アルゴリズムで、量子力学の「観測による重ね合わせの収束」に着想を得た比喩を使う。

処理の流れ（[BorisTheBrave解説](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/)、[原実装README](https://github.com/mxgmn/WaveFunctionCollapse)）:

1. 各セルは「まだ取りうるタイル候補の集合（重ね合わせ状態）」を持つ。
2. **最小エントロピー選択**: 候補数が最も少ない（かつ2つ以上残っている）セルを選ぶ。
3. **collapse**: そのセルを重み付きランダムで1つのタイルに確定する。
4. **制約伝播（propagation）**: 隣接セルの候補集合から、確定したタイルと矛盾する（隣接ルールに反する）タイルを取り除く。これが波及的に連鎖する。
5. 全セルが確定するか、**contradiction**（あるセルの候補が0になる）が起きるまで1〜4を繰り返す。

2つのモデルがある:
- **Overlapping model**: サンプル画像からNxN（典型3x3）パターンを抽出し、出力の各NxN近傍が入力に存在したパターンと一致するよう生成する。
- **Simple Tiled model**: タイルセットと「どのタイルがどのタイルの隣に来られるか」という隣接ルールを人手で定義し、そのルールに基づいて生成する。地形・ダンジョンタイルマップ生成で使われるのはこちら。

### 何を表現するのに向いているか

- タイルベースで**整った・構造的な**パターン（部屋・通路が繋がるダンジョン、建物内部、パイプ状の道など）に強い。エッジのマッチングで局所的な整合性を保証できる。
- 商用実績: *Bad North*, *Caves of Qud*, *Townscaper*, *Matrix Awakens* など（[原README](https://github.com/mxgmn/WaveFunctionCollapse)）。
- 弱点: 隣接制約は**局所的**にしか効かないため、大陸・山脈のような**大域的な構造**は自然には生まれず、「均質で計画性のない見た目」になりがち（[BorisTheBrave](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/)）。連続的な高さ場・地形のような表現には不向きで、山や海のような自然地形よりも人工的なタイル構造物向き。

### Contradiction問題（パラメータ調整の難しさ）

- 複雑なタイルセットでは、あるセルをcollapseした結果、他のセルの候補が0になる「矛盾」が発生しうる（[gridbugs.org](https://www.gridbugs.org/wave-function-collapse/)）。
- 対処法は主に3つ: (1) 単純に**やり直し**（最も一般的だが無駄が多い）、(2) **バックトラック**（直前のcollapseを取り消して別の選択肢を試す）、(3) タイル重みを調整して矛盾確率を下げる（[DrCodes記事](https://drcodes.com/posts/wave-function-collapse-master-procedural-dungeon-generation)）。
- 理論的には「常に高速に完了する解法は作れない」（この判定問題はNP困難）が、原著者Guminいわく「タイルの選び方とランダム化が妥当なら、実務上バックトラックはほとんど不要」（[原README](https://github.com/mxgmn/WaveFunctionCollapse)）。とはいえ、指数時間の最悪ケースが理論上存在し、大規模生成では不向きという指摘もある（[検索結果まとめ](https://www.gridbugs.org/wave-function-collapse/) — 「for large-range generation, this can be unsuitable for commercial games」という論調）。

### JS/TS実装コスト

- アルゴリズム自体（エントロピー選択＋伝播キュー）はコード量としては小〜中規模だが、「全体のロジックは単純に見えて、細部の実装が難所になる」（["the overall function is straightforward but the details can really hang you up"](https://drcodes.com/posts/wave-function-collapse-master-procedural-dungeon-generation)）。
- **最大のコストはタイルセット設計**: Simple Tiled Modelでは各タイルの4辺（上右下左）に対して「どのタイルと接続可能か」を手動で列挙する必要があり、タイル種類が増えるほど組み合わせ的にルール定義が煩雑になる（[検索結果](https://drcodes.com/posts/wave-function-collapse-master-procedural-dungeon-generation)）。対称性タイプを使ってルール数を減らす工夫はあるが、それ自体の学習コストもある。
- npm上に既存JS/TS実装は複数存在する（"wavefunctioncollapse" 等のパッケージ名で検索可能）が、原実装はC#（[mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)）で、TS移植は複数の非公式プロジェクトが存在する状態（今回のWeb検索では公式npmパッケージの決定版は確認できず）。

### パフォーマンス特性

- 生成はグリッドサイズ・タイル数に依存する反復処理。初回生成のみ（マップ生成時に1回走らせて終わり）であればCanvas 2Dのリアルタイム描画とは独立に扱えるため、フレームレートへの影響は基本的にない。
- ただし矛盾が起きた場合の再試行・バックトラックがあるため、**生成時間が非決定的**（ワーストケースで長くなりうる）。ゲーム内でのリアルタイム地形生成（tick中に動的生成）には不向きで、起動時・シーン開始時のバッチ生成向き。

## 2. Voronoi分割

### 基本アルゴリズム

平面上に配置した種点（seed point）集合に対し、各点を「最も近い種点がどれか」で領域分割する。計算には**Fortune's algorithm**（走査線法、O(n log n)）が標準的に使われる（[bitbanging記事](https://www.bitbanging.space/posts/voronoi-diagram-with-fortunes-algorithm)）。Delaunay三角形分割と双対関係にあり、実装ではDelaunayを先に計算してVoronoiを導出することが多い。

### 地形生成での使われ方

- [redblobgames（Amit Patel）のPolygonal Map Generation for Games](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)が古典的なリファレンス（本セッションでは証明書エラーで直接フェッチ不可、他の解説記事から間接的に内容確認）。ランダム種点→Voronoi分割→**Lloyd relaxation**（各セルの重心に種点を移動して再分割、を数回繰り返す）で「自然に見える不揃いな多角形」を作るのが定番の流れ（[squeakyspacebar.github.io](https://squeakyspacebar.github.io/2017/07/12/Procedural-Map-Generation-With-Voronoi-Diagrams.html)、[Wikipedia: Lloyd's algorithm](https://en.wikipedia.org/wiki/Lloyd's_algorithm)）。
- 各Voronoiセルに高度・湿度・温度などのパラメータを割り当ててバイオーム分類する手法が一般的（Whittaker図によるバイオーム分類など）。セル境界はそのまま**地域・陣営・縄張りの境界**、あるいは川・道路の経路としても使われる（[Wayline記事](https://www.wayline.io/blog/heightmaps-voronoi-diagrams-game-world-generation)、[Game Genius Lab記事](https://www.gamegeniuslab.com/tutorial-post/voronoi-diagrams-in-game-development-procedural-maps-ai-territories-stylish-effects/)）。
- プレートテクトニクス風の地形生成例（[squeakyspacebar.github.io](https://squeakyspacebar.github.io/2017/07/12/Procedural-Map-Generation-With-Voronoi-Diagrams.html)）: セクション（細かいVoronoiセル）をランダムにflood fillで「プレート」にまとめ、プレート境界の応力から標高を計算し外側へ減衰させる、という多段構成。

### パラメータ調整の難しさ（不自然な境界）

- 種点をそのままランダム配置すると、Voronoiセルの境界が**直線的で不自然**に見える。上記の実際の実装例でも「境界が鋭すぎ、プレートサイズが規則的すぎる」問題が報告されている（[squeakyspacebar.github.io](https://squeakyspacebar.github.io/2017/07/12/Procedural-Map-Generation-With-Voronoi-Diagrams.html)）。
- 対処として**Lloyd relaxation**（種点を重心へ移動して再分割を繰り返す）を使うと、セルの形が均質化・丸みを帯び、境界のガタつきが緩和される（[Jason Daviesのインタラクティブ解説](https://www.jasondavies.com/lloyd/)）。ただし相対しすぎると逆にセルが均一になりすぎ、意図した不規則さ・自然さが失われるトレードオフがある。
- Voronoi単体では「境界線が直線（Delaunay辺の垂直二等分線）」という幾何的性質上、湖沼の輪郭や海岸線のような曲線的表現には不向きで、ノイズなどで境界を歪ませる後処理が必要になることが多い（今回のソースでは明示的な言及なし、squeakyspacebar記事の実装上の工夫から推測される限界として記載）。

### JS/TS実装コスト

- 自前実装（Fortune's algorithmのフルスクラッチ）は難易度が高いが、**既存ライブラリが豊富**で自前実装は基本不要:
  - [d3-delaunay](https://github.com/d3/d3-delaunay)（[mapbox/delaunator](https://github.com/mapbox/delaunator)ベース、旧d3-voronoiの5〜10倍高速、Canvas 2Dへの直接描画メソッド`context.moveTo`/`context.arc`を持つ）
  - [gorhill/Javascript-Voronoi](https://github.com/gorhill/Javascript-Voronoi)（外部依存なしのスタンドアロン実装）
  - npm: `d3-delaunay`, `voronoi` など。
- d3-delaunayはCanvas renderingコンテキストを直接受け取る設計なので、Canvas 2Dベースの本プロジェクトとの親和性が高い。

### パフォーマンス特性

- Delaunator（d3-delaunayの内部実装）のベンチマーク: 一様分布10万点で約82ms、100万点でも約1.07秒（[npm/d3-delaunay関連の検索結果](https://www.npmjs.com/package/d3-delaunay)）。マップ生成に使う程度の点数（数十〜数百）であれば実質**ミリ秒未満〜数ミリ秒**で完了し、初回生成時の一括計算として問題なく使える。tick毎の再計算のようなリアルタイム用途にも耐えうる余裕がある。

## 3. 「歩行不可の壁」「連続的な地形」どちらに向くか

- **WFC**: タイル単位の整合性（壁と床が正しく繋がる、通路が閉じない等）を保証するのが得意で、**歩行不可の壁・区画された構造物**の表現に向く。一方で連続的な高さ場・自然な地形のなだらかな変化を表現するのは苦手（タイルの離散性・局所ルールの制約のため）。
- **Voronoi**: セル単位の**領域分割**（バイオーム境界、縄張り、拠点の勢力圏）を表現するのに向くが、それ自体は「壁」を作らない。壁として使うにはセル境界を追加ルールで通行不可にするなど後処理が必要。連続的な地形表現にも単体では向かず、ノイズ（Perlinなど、本調査のスコープ外）と組み合わせるのが一般的（[Wayline記事](https://www.wayline.io/blog/heightmaps-voronoi-diagrams-game-world-generation)で言及されているnoise+Voronoiのハイブリッド手法）。
- 総括: 両手法とも単体で「壁」と「連続地形」の両方をきれいに表現するものではなく、**用途特化のツール**として使い分ける、または他手法（ノイズ、セルオートマトン等、スコープ外）と組み合わせるのが実務上の定石という論調が複数ソースで一致している。

## 出典一覧

- [Wave Function Collapse Explained – BorisTheBrave.Com](https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/)
- [Wave Function Collapse tips and tricks – BorisTheBrave.Com](https://www.boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks/)
- [mxgmn/WaveFunctionCollapse (原実装README)](https://github.com/mxgmn/WaveFunctionCollapse)
- [Procedural Generation with Wave Function Collapse – gridbugs.org](https://www.gridbugs.org/wave-function-collapse/)
- [Wave Function Collapse: Master Procedural Dungeon Generation – DrCodes](https://drcodes.com/posts/wave-function-collapse-master-procedural-dungeon-generation)
- [Polygonal Map Generation for Games – redblobgames / Amit Patel](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)（証明書エラーのため間接引用）
- [Procedural Terrain Generation With Voronoi Diagrams – squeakyspacebar.github.io](https://squeakyspacebar.github.io/2017/07/12/Procedural-Map-Generation-With-Voronoi-Diagrams.html)
- [Heightmaps and Voronoi Diagrams – Wayline](https://www.wayline.io/blog/heightmaps-voronoi-diagrams-game-world-generation)
- [Voronoi Diagrams in Game Development – Game Genius Lab](https://www.gamegeniuslab.com/tutorial-post/voronoi-diagrams-in-game-development-procedural-maps-ai-territories-stylish-effects/)
- [Voronoi diagrams with Fortune's algorithm – bitbanging](https://www.bitbanging.space/posts/voronoi-diagram-with-fortunes-algorithm)
- [Lloyd's algorithm – Wikipedia](https://en.wikipedia.org/wiki/Lloyd's_algorithm)
- [Lloyd's Relaxation – Jason Davies](https://www.jasondavies.com/lloyd/)
- [d3/d3-delaunay (GitHub)](https://github.com/d3/d3-delaunay)
- [gorhill/Javascript-Voronoi (GitHub)](https://github.com/gorhill/Javascript-Voronoi)
- [d3-delaunay – npm](https://www.npmjs.com/package/d3-delaunay)

## 限界・未解決

- redblobgames本文は証明書エラーで直接取得できず、他記事経由の間接情報にとどまる。
- WFCの公式npm/TS移植の決定版（メンテナンス状況・型定義の有無）は今回未確認。採用検討時は個別に実装を精査する必要あり。
- Voronoiの「境界を曲線的にする」具体的なテクニック（ノイズによる歪み等）の一次情報は本調査では未収集（スコープ外のノイズ生成と重なるため）。
