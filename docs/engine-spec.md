# エンジン仕様

## boidの状態と物理

boidが持つ状態は**位置・向き(heading)・速さ(speed)のみ**（＋内部メモリ・
運搬中の資源量・燃料）。**加速度・慣性の概念は意図的に存在しない。** これは
検討の結果ではなく、ユーザーが明示的に指定した設計（過去に一度、加速度
ベースの慣性モデルを勝手に実装してしまい、指摘を受けて撤去した経緯がある。
詳細は[CLAUDE.md](../CLAUDE.md)の「重要な設計制約」を参照）。

- 毎tick、プログラムは「今tickでheadingに加える回転角(`Action.turn`、
  ラジアン、**上限なし**)」と「次tickの速さ(`Action.speed`、
  `PHYSICS.maxSpeed`でクランプ)」の2スカラーを返す。
- `boid.heading += action.turn`（先に回転）→
  `boid.pos += {x: cos(heading), y: sin(heading)} * speed`（回転後の向きへ
  前進）の順で1tick分の物理を適用する（dtによるスケーリングは無い。「1tick」
  がこのシミュレーションの唯一の時間単位）。
- 旋回に上限を設けていないのは意図的な選択。「回転角＋速さ」という
  行動表現は、旋回無制限であれば旧来の「速度ベクトルを直接指定する」
  モデルと数学的に等価（表現力が同じ）であり、操作の難易度を上げる
  新しい制約を無断で追加しないため（過去の慣性モデルの失敗を繰り返さない
  ための判断）。
- 燃料が0の間はheading・speedとも変更できず停止する（下記「燃料」参照）。

## ローカル座標系（heading基準の知覚）

boidの知覚（`NeighborView`の相対位置・相対速度）は、**知覚元boid自身の
現在のheadingを基準としたローカル座標系**で表現される（`+x`が常に「自分の
正面」）。ワールド軸に揃えた絶対座標基準の差分ではない。Craig Reynoldsの
steering behaviors原論文と同じ考え方（obstacle avoidanceをローカル座標系
で計算する手法）に倣っている。

- boidは自分自身の絶対headingを知らない（`SelfView`にheadingは含まれない）。
  「自分の前方」は常に固定された基準軸であり、それ以外の方向の情報を
  必要とする場面がない設計。
- この結果、`SelfView.speed`（速さのみ、方向は常に「正面」なので不要）が
  唯一の自分の運動状態。
- **例外: `NeighborView.relBase`はheadingで回転させない。** これは
  「補給所の位置」ではなく「拠点を基準にした補給所の相対位置」という、
  知覚元boidの位置にもheadingにも依存しないインフラ同士の関係を表す値
  だから（回転させると同じ補給所なのにboidごとに違う値になってしまい、
  拠点基準の情報としての意味が崩れる）。詳細は下記「補給所(Station)と
  建設(build)」参照。

## boidプログラムのインターフェース（`src/perception.ts`）

```ts
type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;
```

- `SelfView`: 自分のID・速さ・運搬中の資源量・残燃料・内部メモリ（読み書き可、
  長さ`MEMORY_SIZE`の`number[]`）。**絶対位置もheadingも含まれない。**
- `NeighborView[]`: 視界内(`PHYSICS.viewRadius`)にいるboid/資源/拠点/補給所。
  heading基準ローカル座標系での相対位置・相対速度に加え、boidなら運搬中
  かどうか(`cargo`)・ID(`id`)・内部メモリ（読み取り専用）も見える。資源は
  `amount`（残量）が見える。拠点・補給所は搬入済み資源量をグローバル管理に
  変更したため、個別の`amount`は持たない（下記「補給所(Station)と
  建設(build)」参照）。補給所(`kind === 'station'`)は`relBase`（拠点からの
  相対位置、回転させない例外、上記参照）が見える。
- `Action`: `turn`（今tickの回転角）・`speed`（次tickの速さ）、および
  `harvest`(採取) / `drop`(搬入) / `handoff`(他boidへの荷物の受け渡し) /
  `build`(補給所の建設)の意思表示。実際に成立するかは`PHYSICS.interactRadius`
  （`build`だけ`maxLineLength`）内に対象がいるかを`simulate.ts`側で判定する。

`perception.ts`が「boidは絶対位置を知らない」という制約をコードレベルで
強制している場所。`World`/`Boid`の絶対座標情報・絶対headingはここから外
（program）へは一切渡らない。`NeighborView.id`・`relBase`は例外的に真の
絶対情報から導出した値を渡している（上記参照）が、これは「boid自身の絶対
位置」ではなく「既知のインフラの、拠点を基準にした相対情報」なので設計
制約には抵触しない。

## 燃料（fuel）

デフォルトは無制限（`Infinity`、`createBoid()`の第3引数省略時）。行動範囲を
制限したいシナリオだけ`createBoid()`で有限の燃料を明示的に渡す（現状は
広域探索シナリオのみ）。拠点または補給所(`interactRadius`内)にいる間だけ
全回復する。**燃料が0になると、programがどんな`turn`/`speed`を返しても
heading・speedともその場に固定され停止する**（直前の速度で慣性移動する、
という以前の挙動はユーザーの要求で廃止した。燃料切れ中に無料で旋回できて
しまうことも防いでいる）。

距離設定を変えるときは**「片道は燃料内で届くが往復はできない」の関係を
崩さないこと**。片道の距離が燃料上限を超えると、燃料は拠点（や補給所）でしか
補給できないため誰も資源に到達できず、原理的に解けなくなる（実際にこのバグを
一度踏んでいる）。

## 補給所(Station)と建設(build)

boidは、既存の拠点または補給所から`PHYSICS.maxLineLength`以内であれば、
`Action.build`で新しい補給所をその場（自分の現在位置）に無コストで建設できる。
`simulate.ts`が真の絶対座標で距離判定するため、判定はboidの推定に依存しない
（perception.tsを経由しない、エンジン側で完結する制約）。

- `Station`は`{ id, pos }`のみ。距離などの「推定値」に類する付随情報は意図的
  に持たせない。「建設時点の推定値をずっと保持している」状態を避けるため
  （詳細は`world.ts`の`Station`定義コメント参照）。
- 補給所は拠点と同様、`interactRadius`内にいるboidの燃料を全回復させる。
  資源の搬入(`drop`)も拠点と同様に受け付け、`world.stored`（拠点・補給所を
  問わないグローバルな合計カウンタ）に加算される——搬入完了として扱われ、
  勝利条件の集計にも含まれる。「最寄りの補給所に運べば搬入完了」になることで、
  拠点まで毎回戻る必要がなくなり、boidの行動範囲が拠点周辺に束縛されず
  スケールする、というのが狙い。
  以前は`Base`/`Station`がそれぞれ個別に`stored`を持っていたが、「拠点/補給所
  ごとに資源を管理しない」というユーザーの要望により、単一の`world.stored`に
  一本化した。これに伴い`NeighborView`の拠点・補給所の`amount`（個別の貯蔵量）
  は廃止した——どのboidプログラムもこれを読んでいなかったため実質的な影響は
  ない（読んでいたのは`kind === 'resource'`の`amount`のみ）。canvas上の
  拠点・補給所ごとの数値表示も同じ理由で廃止し、合計は既存のステータス表示
  （`checkWin().detail`）でのみ見える。
- `NeighborView.relBase`（`kind === 'station'`のときだけ）は、その補給所の
  「拠点からの相対位置」を**perception.ts側が毎tick真の絶対座標から計算し直す**
  値。station自体は何も記憶していない。単一拠点前提（`world.bases[0]`）。

### 建設の集中回避（リーダー選出パターン）

分離力のない密集した群れが同時に建設条件を満たすと、同じ場所に補給所が重複
して建ってしまう（実際にヘッドレス検証で複数回発見・修正した）。これを
`src/programs/frontier.ts`は次のパターンで解決している（新しいプログラムで
同種の「複数個体の同時行動」問題が起きたらこのパターンの再利用を検討する。
このパターンは元々`ladder.ts`/`supply-line.ts`で確立したもので、heading
基準の知覚モデルへの移行に伴いこの2シナリオは削除されたが、パターン自体は
`frontier.ts`に引き継がれている）:

- `memory[2]`を「今この行動をしたいか」の意思表示として毎tickブロードキャスト
  する（1=あり/0=なし）。
- 視界内で意思表示中の他boidのうち、自分よりIDが大きい個体が1体もいなければ
  実行する（`programs/util.ts`の`isLocalMax`）。IDは`NeighborView.id`として
  構造的に見える（`cargo`と同様、memory経由でブロードキャストする必要はない）。
- 意思表示を出し始めたそのtickでは実行を許可せず、前tickから連続して意思表示
  していた場合のみ許可する（`wasIntending`）。`simulate.ts`の`step()`が
  boidのmemoryをmap内で即座に書き戻すため、同tick内でIDが若いboidの書き込みが
  IDが大きいboidから見えてしまう非対称なリークがあり、1tickだけの判定では
  同tickの重複を防ぎきれないため。この非対称性と正しさの証明の詳細は
  `programs/frontier.ts`のdocコメントを参照。
- dead reckoningによる判定閾値の近くだけでなく、**視界内に既にmaxLineLength
  以内のアンカーが見えていたら無条件で意思表示を取り下げる**追加ガードも
  必要だった。負けた側が`interactRadius`（dead reckoningのリセット判定）
  よりわずかに遠い位置にいると、勝者の建設後もリセットされず、次tickに
  「競争相手がいない」と誤認識してもう1つ近くに建ててしまうため。

### memoryスロットの慣習

`MEMORY_SIZE = 4`のうち、`memory[0..1]`は既存プログラム全体で「直前の既知
アンカーからの推定変位（dead reckoning）」という共通の用途で使われている。
`frontier.ts`は追加で`memory[2]`を上記の建設意思表示に使う。`memory[3]`は
現状未使用。新しいプログラムを書くときは、この慣習に合わせるか、意図的に
外れるならその理由をコメントに残すこと。

**dead reckoningは回転補正付き。** 知覚がheading基準のローカル座標系に
なったため（上記「ローカル座標系」参照）、`self.vel`を単純に毎tick積算する
だけでは基準がtickごとに変わってしまい破綻する。`programs/util.ts`の
`updateDeadReckoning(memory, turn, speed)`が、蓄積済みの推定変位を「これ
から適用するturn」ぶん逆回転させてから今tickの前進量を足し込むことで、
tickごとに座標系が回転しても正確な推定を維持する。呼び出しは各プログラムの
末尾、その tickに実際に返すturn/speedが確定した後に行う（先に呼ぶと
build判定などがまだ反映されていない今tickの移動を含んでしまい結果が
変わるため、呼び出し順を変えないこと。詳細は`programs/frontier.ts`の
docコメント・`programs/util.ts`のコメント参照）。

（余談：`frontier.ts`は当初`memory[3]`にscenario側が割り当てた個体固有の
固定探索方位を持たせていたが、「boid自身が周囲の状況を見て進む方向を判断する」
という設計に変更した際に廃止した。詳細はroadmap.md参照。）

## モジュール構成

```
src/
  vec2.ts               2Dベクトル演算
  world.ts              World/Boid/ResourceNode/Base/Station の型定義、PHYSICS定数
  perception.ts         boidへの「知覚」の組み立て（絶対座標→相対情報の唯一の変換点）
  simulate.ts           1tick分の更新（program呼び出し→物理→採取/搬入/受け渡し/建設）
  render.ts             Canvas描画
  scenario.ts           Scenario共通インターフェース
  scenarios/*.ts         シナリオごとの初期配置・勝利条件
  programs/*.ts          実際に「プレイヤーが書くもの」＝boidプログラム本体
                         （util.tsは`closest`/`isLocalMax`などの共通ヘルパー）
  main.ts                シナリオ切り替えUIとメインループ、devビルドのみ
                         window.__simデバッグフック（下記参照）
```

## シナリオ一覧

| # | シナリオ | 検証していること | 勝利条件 | 状態 |
|---|---|---|---|---|
| 1 | 収集・搬入 (`scenarios/gather.ts`) | 最も単純な協調（探索・凝集・運搬）が成立するか | 資源を8個拠点に搬入（2700tick以内） | ✅ |
| 2 | 隊列・陣形維持 (`scenarios/formation.ts`) | 局所ルールだけで陣形が自己組織化するか | 拠点周囲の半径35のリング陣形を維持 | ✅ |
| 6 | 広域探索・実験 (`scenarios/frontier.ts`) | 資源の方向も初期位置も一切知らない状態で、フェロモンなしの分離則（Separation）による自己組織化的な拡散＋補給所建設だけで資源クラスタ（資源が集中して存在する地点、4箇所配置）を発見・回収できるか | 資源を5個、拠点または補給所に搬入（180000tick以内） | ✅ headless 10回中10勝（tick 445〜1264で勝利）。番号は導入順のなごりで3〜5は欠番（旧・中継リレー輸送/ラダー/補給線輸送、下記参照） |

**旧シナリオ「中継リレー輸送」「補給網拡張・ラダー」「補給線輸送」は削除済み。**
heading基準のローカル座標系への移行に伴い、これら3シナリオが依存していた
「全boid共有の固定探索方向`EXPLORE_DIR`」という前提が成立しなくなったため
（boidごとに座標系が回転する新モデルでは「共有の絶対方向」という概念自体が
無意味になる）。Station建設・リーダー選出パターンは`frontier.ts`が引き続き
使うため、エンジン側の仕組みとしては存続している。経緯の詳細は
[roadmap.md](roadmap.md)を参照。

各シナリオの現状の評価・既知の課題は [roadmap.md](roadmap.md) を参照。

## 開発支援: `window.__sim`（devビルドのみ）

自動操作されるブラウザタブは`document.visibilityState === 'hidden'`扱いに
なり、Chromeの仕様で`requestAnimationFrame`が完全停止する（実測で18秒間
コールバック0回）。通常の描画ループ（`main.ts`の`loop()`）はこの状態では
実質止まって見えるため、`main.ts`に`import.meta.env.DEV`限定で
`window.__sim`というデバッグフックを用意している（本番ビルドではtree-shaking
で消える）。

```js
window.__sim.selectScenario(window.__sim.scenarios.find(s => s.id === 'frontier'));
window.__sim.step(500); // 同期的に500tick進めて1回だけ再描画。rAFやタブの表示状態に無関係
```

`window.__sim.world`/`.scenario`で現在の状態も直接読める。ブラウザの
JavaScriptコンソール（またはCDP経由のJS実行）から使う想定。
