import './style.css';
import { render } from './render';
import type { Scenario } from './scenario';
import { formationScenario } from './scenarios/formation';
import { frontierScenario } from './scenarios/frontier';
import { gatherScenario } from './scenarios/gather';
import { step } from './simulate';
import type { World } from './world';

const SCENARIOS: Scenario[] = [gatherScenario, formationScenario, frontierScenario];

const controls = document.querySelector<HTMLDivElement>('#controls')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d')!;

let current: Scenario = SCENARIOS[0];
let world: World = current.createWorld();

const debugViewRadiusLabel = document.createElement('label');
const debugViewRadiusCheckbox = document.createElement('input');
debugViewRadiusCheckbox.type = 'checkbox';
debugViewRadiusLabel.appendChild(debugViewRadiusCheckbox);
debugViewRadiusLabel.append('視界範囲を表示');

function selectScenario(scenario: Scenario): void {
  current = scenario;
  world = current.createWorld();
  canvas.width = world.width;
  canvas.height = world.height;
  renderButtons();
}

function renderButtons(): void {
  controls.innerHTML = '';
  for (const s of SCENARIOS) {
    const btn = document.createElement('button');
    btn.textContent = s.name;
    btn.setAttribute('aria-pressed', String(s.id === current.id));
    btn.onclick = () => selectScenario(s);
    controls.appendChild(btn);
  }
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'リセット';
  resetBtn.onclick = () => selectScenario(current);
  controls.appendChild(resetBtn);
  controls.appendChild(debugViewRadiusLabel);
}

function loop(): void {
  step(world, current.program);
  render(ctx, world, debugViewRadiusCheckbox.checked);
  const win = current.checkWin(world);
  statusEl.textContent = `${current.name}\n${current.description}\n${win.won ? '✅ ' : ''}${win.detail}`;
  requestAnimationFrame(loop);
}

// 非表示タブではrequestAnimationFrameがブラウザ仕様で完全停止するため、
// 自動操作ツールから見た目を確認する手段としてrAFに頼らない経路を用意する。
// devビルドのみ有効（本番ビルドではimport.meta.env.DEVがfalseになり丸ごと
// tree-shakingで消える）。window.__sim.step(n)で同期的にn tick進めて
// 1回だけ再描画できるので、タブの表示状態に関係なく即座に結果を確認できる。
if (import.meta.env.DEV) {
  (window as unknown as { __sim: unknown }).__sim = {
    get world() {
      return world;
    },
    get scenario() {
      return current;
    },
    scenarios: SCENARIOS,
    selectScenario,
    step(n = 1) {
      for (let i = 0; i < n; i++) step(world, current.program);
      render(ctx, world, debugViewRadiusCheckbox.checked);
      return current.checkWin(world);
    },
  };
}

selectScenario(SCENARIOS[0]);
requestAnimationFrame(loop);
