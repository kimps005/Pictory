const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(reduceMotion = false) {
  const handlers = new Map(), frames = new Map(), calls = [];
  let cleanup, frameId = 0, now = 0;
  const window = {
    scrollY: 0,
    matchMedia: () => ({ matches: reduceMotion }),
    // 전역 CSS가 smooth일 때 instant 이외의 호출은 즉시 위치를 갱신하지 않는다.
    scrollTo(options) {
      calls.push(options);
      if (options.behavior === 'instant') this.scrollY = options.top;
    },
    addEventListener: (name, callback) => handlers.set(name, callback),
    removeEventListener: name => handlers.delete(name),
  };
  const filename = path.resolve(__dirname, '../app/components/HeroParallax.tsx');
  const context = {
    exports: {}, window,
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ top: 900 - window.scrollY }) }) },
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    require: id => id === 'react' ? {
      useEffect(callback) { cleanup = callback(); },
      useRef: () => ({ current: null }),
    } : require(id),
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context, { filename });
  context.exports.default({ targetId: 'home-below', children: null });
  return {
    window, frames, handlers, calls,
    cleanup: () => cleanup(),
    wheel(deltaY, extra = {}) {
      let prevented = false;
      handlers.get('wheel')({ deltaY, deltaX: 0, ...extra, preventDefault() { prevented = true; } });
      return prevented;
    },
    advance(time) {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(now));
    },
  };
}

test('작은 휠 입력 한 번으로 전역 smooth 설정에서도 다음 영역에 도착한다', () => {
  const page = setup();
  assert.equal(page.wheel(1), true);
  page.advance(16);
  assert.ok(page.window.scrollY > 0);
  assert.ok(page.window.scrollY < 828);
  page.advance(620);
  assert.equal(page.window.scrollY, 828);
  assert.equal(page.frames.size, 0);
  // 다음 영역에 도착한 뒤에는 아래쪽의 일반 스크롤을 막지 않는다.
  assert.equal(page.wheel(100), false);
  assert.equal(page.wheel(-100), true);
  page.advance(1240);
  assert.equal(page.window.scrollY, 0);
});

test('움직임 줄이기를 설정하면 한 번의 휠 입력으로 즉시 이동한다', () => {
  const page = setup(true);
  assert.equal(page.wheel(100), true);
  assert.equal(page.window.scrollY, 828);
  assert.equal(page.frames.size, 0);
});

test('가로 스크롤과 확대 동작은 전환을 시작하지 않는다', () => {
  const page = setup();
  assert.equal(page.wheel(0), false);
  assert.equal(page.wheel(1, { deltaX: 20 }), false);
  assert.equal(page.wheel(100, { ctrlKey: true }), false);
  assert.equal(page.frames.size, 0);
});

test('전환 도중 화면을 떠나면 남은 애니메이션과 이벤트를 해제한다', () => {
  const page = setup();
  page.wheel(100);
  page.advance(16);
  const position = page.window.scrollY;
  page.cleanup();
  page.advance(620);
  assert.equal(page.window.scrollY, position);
  assert.equal(page.frames.size, 0);
  assert.equal(page.handlers.size, 0);
});
