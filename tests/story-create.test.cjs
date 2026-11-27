const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

// Run the real page handlers and story hook offline, with separate hook state per component.
function hookRuntime() {
  const slots = [];
  let cursor = 0;
  return {
    render(component) { cursor = 0; return component(); },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        return slots[index] ??= { current: initial };
      },
      useMemo: factory => factory(),
      useCallback: callback => callback,
      useEffect: () => {},
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
  };
}

function loadTs(file, mocks, cache = new Map()) {
  const filename = path.resolve(__dirname, '..', file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const fallback = mod.require.bind(mod);
  mod.require = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('.') || id.startsWith('@/')) {
      const base = id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : path.resolve(path.dirname(filename), id);
      const target = ['.ts', '.tsx'].map(ext => base + ext).find(candidate => fs.existsSync(candidate));
      if (target) return loadTs(target, mocks, cache);
    }
    return fallback(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

function setup({ savedMemo = '' } = {}) {
  const story = hookRuntime(), page = hookRuntime();
  const navigations = [], deleted = [], drawings = [];
  const readRaw = key => key === 'story-choice:lastMemo:tester' ? savedMemo : '';
  const store = {
    useStored: readRaw,
    readRaw,
    writeRaw: () => {},
    removeKey: key => deleted.push(key),
  };
  const { useStory } = loadTs('app/useStory.ts', {
    react: story.react,
    '@/lib/localStore': store,
    './useStoryImages': { useStoryImages: () => ({
      images: [], clearImages() {}, appendImages() {},
      setDrawing: file => drawings.push(file), hasDrawing: () => !!drawings.at(-1),
    }) },
  });
  const app = { user: 'tester', library: [], pet: { state: { moods: {} } } };
  const { CreateForm } = loadTs('app/create/CreateForm.tsx', {
    react: page.react,
    'next/navigation': { useRouter: () => ({ push: route => navigations.push(route) }) },
    '@/lib/localStore': store,
    '@/lib/parentInsights': { buildRecentStoryContext: () => '', cachedStoryGuidance: () => '' },
    '../providers': { useApp: () => app },
    '../components/LoadingAnimation': { WritingAnimation: () => null },
  });
  function render() {
    app.s = story.render(() => useStory('tester'));
    return page.render(() => CreateForm({}));
  }
  let tree = render();
  find(tree, node => node.type === 'button' && node.props.children === '밤에 혼자 자기 무서워').props.onClick();
  tree = render();
  find(tree, node => node.props?.label === '아이 나이').props.onChange(7);
  tree = render();
  find(tree, node => node.props?.label === '동화 길이').props.onChange('custom');
  tree = render();
  find(tree, node => node.type === 'input' && node.props.maxLength === 50).props.onChange({ target: { value: '파란 토끼' } });
  tree = render();
  find(tree, node => node.props?.['aria-label'] === '동화 길이(분)').props.onChange({ target: { value: '8' } });
  // A small fake canvas exercises the real pointer, history and PNG export handlers.
  let pixels = new Uint8ClampedArray(4);
  const ctx = {
    getImageData: () => ({ data: pixels.slice() }), fill: () => { pixels[3] = 255; },
    putImageData: snapshot => { pixels = snapshot.data.slice(); },
    beginPath() {}, arc() {}, moveTo() {},
  };
  const canvas = {
    width: 1200, height: 800, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    setPointerCapture() {}, toDataURL: () => 'data:image/png;base64,test',
    toBlob: callback => callback(new Blob([pixels], { type: 'image/png' })),
  };
  ctx.canvas = canvas;
  const drawing = find(tree, node => node.type === 'canvas');
  drawing.props.ref.current = canvas;
  drawing.props.onPointerDown({ currentTarget: canvas, pointerType: 'mouse', button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  tree = render();
  find(tree, node => node.type === 'canvas').props.onPointerUp({ pointerId: 1 });
  return { render, app, canvas, navigations, deleted, drawings };
}

const segment = {
  title: '달빛 약속', scenes: [{ text: '토끼가 문을 열었어요.', imagePrompt: 'The main character opens a door.' }],
  choice: { prompt: '어떻게 할까?', options: [
    { id: 'a', text: '친구를 불러요', copingType: '도움요청' },
    { id: 'b', text: '다가가요', copingType: '직면' },
  ] }, isEnding: false,
};

test('creation waits for success before navigating and blocks duplicate submissions', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let resolve, calls = 0, request;
  global.fetch = async (_url, init) => {
    calls++;
    request = JSON.parse(init.body);
    return new Promise(done => { resolve = done; });
  };
  const state = setup({ savedMemo: '지난 동화의 메모' });
  const submit = find(state.render(), node => node.type === 'form').props.onSubmit;
  const pending = submit({ preventDefault() {} });
  await Promise.resolve();
  await submit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.deepEqual(state.navigations, [], 'no /read redirect while the request is pending');
  const loading = state.render();
  assert.equal(find(loading, node => node.type === 'form').props.hidden, true);
  assert.equal(find(loading, node => node.type === 'canvas').props.ref.current, state.canvas);
  assert.deepEqual({ age: request.age, situation: request.situation, duration: request.durationMin, protagonist: request.protagonist, drawing: request.hasUserDrawing },
    { age: 7, situation: '밤에 혼자 자기 무서워', duration: 8, protagonist: '파란 토끼', drawing: true });
  assert.equal(request.previousMemo, undefined, 'ordinary creation must not inherit the previous story memo');
  resolve(Response.json(segment));
  await pending;
  assert.deepEqual(state.navigations, ['/read']);
  state.render();
  assert.equal(state.app.s.step, 'story');
});

test('failed creation preserves selections, canvas, edit history and saved story; retry succeeds', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const state = setup();
  global.fetch = async () => Response.json({ error: '이야기를 만들지 못했어요.' }, { status: 500 });
  await find(state.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const failed = state.render();
  assert.deepEqual(state.navigations, []);
  assert.deepEqual(state.deleted, [], 'saved story is deleted only after a successful replacement');
  assert.equal(find(failed, node => node.type === 'form').props.hidden, false);
  assert.equal(find(failed, node => node.props?.role === 'alert').props.children, '이야기를 만들지 못했어요.');
  assert.equal(find(failed, node => node.props?.label === '아이 나이').props.value, 7);
  assert.equal(find(failed, node => node.props?.['aria-label'] === '동화 길이(분)').props.value, '8');
  assert.equal(find(failed, node => node.type === 'input' && node.props.maxLength === 50).props.value, '파란 토끼');
  assert.equal(find(failed, node => node.type === 'canvas').props.ref.current, state.canvas);
  assert.equal(find(failed, node => node.type === 'button' && node.props.children === '↶ 되돌리기').props.disabled, false);
  find(failed, node => node.type === 'button' && node.props.children === '↶ 되돌리기').props.onClick();
  assert.equal(find(state.render(), node => node.type === 'button' && node.props.children === '다시 그리기').props.disabled, true);
  find(state.render(), node => node.type === 'button' && node.props.children === '↷ 다시 실행').props.onClick();
  global.fetch = async () => Response.json(segment);
  await find(state.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(state.navigations, ['/read']);
  assert.deepEqual(state.deleted, ['story-choice:draft:tester', 'story-choice:create-form:tester']);
  assert.deepEqual(await state.drawings[0].arrayBuffer(), await state.drawings[1].arrayBuffer());
});

test('PNG export failure restores the form and allows another attempt', async () => {
  const state = setup();
  state.canvas.toBlob = callback => callback(null);
  await find(state.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const failed = state.render();
  assert.deepEqual(state.navigations, []);
  assert.equal(find(failed, node => node.type === 'form').props.hidden, false);
  assert.match(find(failed, node => node.props?.role === 'alert').props.children, /그림을 저장하지 못했어요/);
  assert.equal(find(failed, node => node.type === 'button' && node.props.type === 'submit').props.disabled, false);
});
