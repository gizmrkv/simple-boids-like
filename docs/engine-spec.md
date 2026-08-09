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
- 燃料が0の間は速度を変更できず、直前の速度のまま慣性で進み続ける
  （下記「燃料」参照。これは「加速度モデルの復活」ではなく、単に
  「新しい速度を受け付けない」という制約）

## boidプログラムのインターフェース（`src/perception.ts`）

```ts
type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;
```

- `SelfView`: 自分のID・速度・運搬中の資源量・残燃料・内部メモリ（読み書き可、
  長さ`MEMORY_SIZE`の`number[]`）。**絶対位置は含まれない。**
- `NeighborView[]`: 視界内(`PHYSICS.viewRadius`)にいるboid/資源/拠点。相対位置・
  相対速度に加え、boidなら運搬中かどうか(`cargo`)と内部メモリ（読み取り専用）も
  見える。資源・拠点は`amount`（残量／貯蔵量）が見える。
- `Action`: 次tickの速度ベクトル(`vel`)、および`harvest`(採取) / `drop`(搬入) /
  `handoff`(他boidへの荷物の受け渡し)の意思表示。実際に成立するかは
  `PHYSICS.interactRadius`内に対象がいるかを`simulate.ts`側で判定する。

`perception.ts`が「boidは絶対位置を知らない」という制約をコードレベルで
強制している場所。`World`/`Boid`の絶対座標情報はここから外（program）へは
一切渡らない。

## 燃料（fuel）

デフォルトは無制限（`Infinity`、`createBoid()`の第3引数省略時）。行動範囲を
制限したいシナリオだけ`createBoid()`で有限の燃料を明示的に渡す（現状は
中継リレー輸送シナリオのみ）。拠点(`interactRadius`内)にいる間だけ全回復する。

距離設定を変えるときは**「片道は燃料内で届くが往復はできない」の関係を
崩さないこと**。片道の距離が燃料上限を超えると、燃料は拠点でしか補給できない
ため誰も資源に到達できず、原理的に解けなくなる（実際にこのバグを一度
踏んでいる）。

## モジュール構成

```
src/
  vec2.ts               2Dベクトル演算
  world.ts              World/Boid/ResourceNode/Base の型定義、PHYSICS定数
  perception.ts         boidへの「知覚」の組み立て（絶対座標→相対情報の唯一の変換点）
  simulate.ts           1tick分の更新（program呼び出し→物理→採取/搬入/受け渡し）
  render.ts             Canvas描画
  scenario.ts           Scenario共通インターフェース
  scenarios/*.ts         シナリオごとの初期配置・勝利条件
  programs/*.ts          実際に「プレイヤーが書くもの」＝boidプログラム本体
  main.ts                シナリオ切り替えUIとメインループ
```

## シナリオ一覧

| # | シナリオ | 検証していること | 勝利条件 |
|---|---|---|---|
| 1 | 収集・搬入 (`scenarios/gather.ts`) | 最も単純な協調（探索・凝集・運搬）が成立するか | 資源を8個拠点に搬入（2700tick以内） |
| 2 | 隊列・陣形維持 (`scenarios/formation.ts`) | 局所ルールだけで陣形が自己組織化するか | 拠点周囲の半径35のリング陣形を維持 |
| 3 | 中継リレー輸送 (`scenarios/relay.ts`) | 燃料範囲を超える距離をboid間の手渡しリレーで運べるか | 資源を4個拠点に搬入（5400tick以内） |

各シナリオの現状の評価・既知の課題は [roadmap.md](roadmap.md) を参照。
