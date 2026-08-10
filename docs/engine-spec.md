# エンジン仕様

## boidの状態と物理

boidが持つ状態は**位置と速度のみ**（＋内部メモリ・運搬中の資源量・燃料）。
**加速度・慣性の概念は意図的に存在しない。** これは検討の結果ではなく、
ユーザーが明示的に指定した設計（過去に一度、加速度ベースの慣性モデルを
勝手に実装してしまい、指摘を受けて撤去した経緯がある。詳細は
[CLAUDE.md](../CLAUDE.md) の「重要な設計制約」を参照）。

- 毎tick、プログラムは「次tickの速度ベクトル」を直接返す
  （`Action.vel`、大きさは`PHYSICS.maxSpeed`でクランプ）
- 次tickの位置は `pos = pos + vel` で決まる（dtによるスケーリングは無い。
  「1tick」がこのシミュレーションの唯一の時間単位）
- 燃料が0の間は速度を変更できず停止する（下記「燃料」参照）

## boidプログラムのインターフェース（`src/perception.ts`）

```ts
type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;
```

- `SelfView`: 自分のID・速度・運搬中の資源量・残燃料・内部メモリ（読み書き可、
  長さ`MEMORY_SIZE`の`number[]`）。**絶対位置は含まれない。**
- `NeighborView[]`: 視界内(`PHYSICS.viewRadius`)にいるboid/資源/拠点/補給所。
  相対位置・相対速度に加え、boidなら運搬中かどうか(`cargo`)・ID(`id`)・内部
  メモリ（読み取り専用）も見える。資源・拠点は`amount`（残量／貯蔵量）が
  見える。補給所(`kind === 'station'`)は`relBase`（拠点からの相対位置、下記
  「補給所(Station)と建設(build)」参照）が見える。
- `Action`: 次tickの速度ベクトル(`vel`)、および`harvest`(採取) / `drop`(搬入) /
  `handoff`(他boidへの荷物の受け渡し) / `build`(補給所の建設)の意思表示。
  実際に成立するかは`PHYSICS.interactRadius`（`build`だけ`maxLineLength`）内に
  対象がいるかを`simulate.ts`側で判定する。

`perception.ts`が「boidは絶対位置を知らない」という制約をコードレベルで
強制している場所。`World`/`Boid`の絶対座標情報はここから外（program）へは
一切渡らない。`NeighborView.id`・`relBase`は例外的に真の絶対情報から導出した
値を渡している（下記参照）が、これは「boid自身の絶対位置」ではなく「既知の
インフラの、拠点を基準にした相対情報」なので設計制約には抵触しない。

## 燃料（fuel）

デフォルトは無制限（`Infinity`、`createBoid()`の第3引数省略時）。行動範囲を
制限したいシナリオだけ`createBoid()`で有限の燃料を明示的に渡す（現状は
中継リレー輸送・ラダー・補給線輸送シナリオ）。拠点または補給所
(`interactRadius`内)にいる間だけ全回復する。**燃料が0になると、programが
どんな`vel`を返しても速度は即座に0になり停止する**（直前の速度で慣性移動する、
という以前の挙動はユーザーの要求で廃止した）。

距離設定を変えるときは**「片道は燃料内で届くが往復はできない」の関係を
崩さないこと**。片道の距離が燃料上限を超えると、燃料は拠点（や補給所）でしか
補給できないため誰も資源に到達できず、原理的に解けなくなる（実際にこのバグを
一度踏んでいる）。

## 補給所(Station)と建設(build)

boidは、既存の拠点または補給所から`PHYSICS.maxLineLength`以内であれば、
`Action.build`で新しい補給所をその場（自分の現在位置）に無コストで建設できる。
`simulate.ts`が真の絶対座標で距離判定するため、判定はboidの推定に依存しない
（perception.tsを経由しない、エンジン側で完結する制約）。

- `Station`は`{ id, pos, stored }`のみ。距離などの「推定値」に類する付随情報
  は意図的に持たせない。「建設時点の推定値をずっと保持している」状態を避ける
  ため（詳細は`world.ts`の`Station`定義コメント参照）。`stored`は`Base`と同じ
  ただの累計カウンタなのでこの原則には抵触しない。
- 補給所は拠点と同様、`interactRadius`内にいるboidの燃料を全回復させる。
  資源の搬入(`drop`)も拠点と同様に受け付け、`stored`に加算される——搬入完了
  として扱われ、勝利条件の集計にも含まれる（`Base`専用だった旧仕様から変更、
  詳細は[roadmap.md](roadmap.md)参照）。「最寄りの補給所に運べば搬入完了」に
  なることで、拠点まで毎回戻る必要がなくなり、boidの行動範囲が拠点周辺に
  束縛されずスケールする、というのが変更の狙い。
- `NeighborView.relBase`（`kind === 'station'`のときだけ）は、その補給所の
  「拠点からの相対位置」を**perception.ts側が毎tick真の絶対座標から計算し直す**
  値。station自体は何も記憶していない。単一拠点前提（`world.bases[0]`）。

### 建設の集中回避（リーダー選出パターン）

分離力のない密集した群れが同時に建設条件を満たすと、同じ場所に補給所が重複
して建ってしまう（実際にヘッドレス検証で複数回発見・修正した）。これを
`src/programs/ladder.ts`と`src/programs/supply-line.ts`は次のパターンで
解決している（新しいプログラムで同種の「複数個体の同時行動」問題が起きたら
このパターンの再利用を検討する）:

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
  `programs/ladder.ts`のdocコメントを参照。
- dead reckoningによる判定閾値の近くだけでなく、**視界内に既にmaxLineLength
  以内のアンカーが見えていたら無条件で意思表示を取り下げる**追加ガードも
  必要だった。負けた側が`interactRadius`（dead reckoningのリセット判定）
  よりわずかに遠い位置にいると、勝者の建設後もリセットされず、次tickに
  「競争相手がいない」と誤認識してもう1つ近くに建ててしまうため。

### memoryスロットの慣習

`MEMORY_SIZE = 4`のうち、`memory[0..1]`は既存プログラム全体で「直前の既知
アンカーからの推定変位（dead reckoning、`self.vel`を積算）」という共通の
用途で使われている。`ladder.ts`/`supply-line.ts`/`frontier.ts`は追加で
`memory[2]`を上記の建設意思表示に使う。`memory[3]`は現状未使用。新しい
プログラムを書くときは、この慣習に合わせるか、意図的に外れるならその理由を
コメントに残すこと。

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
| 3 | 中継リレー輸送 (`scenarios/relay.ts`) | 燃料範囲を超える距離をboid間の手渡しリレーで運べるか | 資源を4個拠点に搬入（5400tick以内） | ❌ 現在勝利不可（roadmap参照） |
| 4 | 補給網拡張・ラダー (`scenarios/ladder.ts`) | 補給所の連鎖を拠点から外側へ自己組織的に伸ばせるか | 拠点から最も遠い補給所が距離390に到達（10800tick以内） | ✅ |
| 5 | 補給線輸送 (`scenarios/supply-line.ts`) | ラダーを使って燃料範囲を超えた資源を往復輸送できるか | 資源を6個、拠点または補給所に搬入（18000tick以内） | ✅ |
| 6 | 広域探索・実験 (`scenarios/frontier.ts`) | 資源の方向も初期位置も一切知らない状態で、フェロモンなしの分離則（Separation）による自己組織化的な拡散＋補給所建設だけで資源クラスタ（資源が集中して存在する地点、4箇所配置）を発見・回収できるか | 資源を5個、拠点または補給所に搬入（180000tick以内） | 🧪 headless 10回中10勝（tick 542〜1431で勝利）。詳細はroadmap.md参照 |

各シナリオの現状の評価・既知の課題は [roadmap.md](roadmap.md) を参照。

## 開発支援: `window.__sim`（devビルドのみ）

自動操作されるブラウザタブは`document.visibilityState === 'hidden'`扱いに
なり、Chromeの仕様で`requestAnimationFrame`が完全停止する（実測で18秒間
コールバック0回）。通常の描画ループ（`main.ts`の`loop()`）はこの状態では
実質止まって見えるため、`main.ts`に`import.meta.env.DEV`限定で
`window.__sim`というデバッグフックを用意している（本番ビルドではtree-shaking
で消える）。

```js
window.__sim.selectScenario(window.__sim.scenarios.find(s => s.id === 'ladder'));
window.__sim.step(500); // 同期的に500tick進めて1回だけ再描画。rAFやタブの表示状態に無関係
```

`window.__sim.world`/`.scenario`で現在の状態も直接読める。ブラウザの
JavaScriptコンソール（またはCDP経由のJS実行）から使う想定。
