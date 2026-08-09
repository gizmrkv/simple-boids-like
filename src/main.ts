import './style.css';
import { render } from './render';
import type { Scenario } from './scenario';
import { formationScenario } from './scenarios/formation';
import { gatherScenario } from './scenarios/gather';
import { relayScenario } from './scenarios/relay';
import { step } from './simulate';
import type { World } from './world';

const SCENARIOS: Scenario[] = [gatherScenario, formationScenario, relayScenario];

const controls = document.querySelector<HTMLDivElement>('#controls')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d')!;

let current: Scenario = SCENARIOS[0];
let world: World = current.createWorld();

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
}

function loop(): void {
  step(world, current.program);
  render(ctx, world);
  const win = current.checkWin(world);
  statusEl.textContent = `${current.name}\n${current.description}\n${win.won ? '✅ ' : ''}${win.detail}`;
  requestAnimationFrame(loop);
}

selectScenario(SCENARIOS[0]);
requestAnimationFrame(loop);
