const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const moduleCache = new Map();
function loadTs(file) {
  const filename = path.resolve(__dirname, '..', file);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = new Module(filename, module);
  moduleCache.set(filename, mod);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const defaultRequire = mod.require.bind(mod);
  mod.require = (id) => {
    const local = id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2) + '.ts') : path.resolve(path.dirname(filename), id + '.ts');
    return (id.startsWith('.') || id.startsWith('@/')) && fs.existsSync(local) ? loadTs(local) : defaultRequire(id);
  };
  mod._compile(compiled, filename);
  return mod.exports;
}

const { drawingBounds, sceneReferences, drawingScenePrompt } = loadTs('lib/image/story-image.ts');
const { classifyImageFailure, fetchCloudflareImage } = loadTs('lib/image/image-upstream.ts');
const { removeExteriorPaper } = loadTs('lib/image/drawing-cutout.ts');

test('paper removal preserves colored pixels and enclosed white body areas', () => {
  const width = 9, height = 9;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) {
    if (x === 2 || x === 6 || y === 2 || y === 6) pixels.set([64, 90, 66, 255], (y * width + x) * 4);
  }
  const original = pixels.slice();
  const output = removeExteriorPaper(pixels, width, height);
  assert.deepEqual(pixels, original);
  assert.equal(output[3], 0);
  assert.deepEqual(output.slice((4 * width + 4) * 4, (4 * width + 4) * 4 + 4), new Uint8ClampedArray([255, 255, 255, 255]));
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 64)
    assert.deepEqual(output.slice(i, i + 4), pixels.slice(i, i + 4));
});

test('original composition bypasses model identity generation and survives exhausted Cloudflare quota', async () => {
  const sharp = require('sharp');
  const originalFetch = global.fetch;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'; process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  const source = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/><rect x="20" y="10" width="24" height="42" fill="white" stroke="#405a42" stroke-width="4"/></svg>')).png().toBuffer();
  let failure = null, calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.body.has('input_image_0'), false, 'model generates the background, never the protagonist');
    if (failure === 'quota') return Response.json({ errors: [{ code: 4006, message: 'used up your daily free allocation' }] }, { status: 429 });
    if (failure === 'busy') return Response.json({ errors: [{ code: 3040 }] }, { status: 429, headers: { 'retry-after': '60' } });
    if (failure === 'flagged') return Response.json({ errors: [{ code: 3030, message: 'output has been flagged' }] }, { status: 400 });
    return new Response(await sharp({ create: { width: 512, height: 512, channels: 3, background: '#c0ddee' } }).png().toBuffer(), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const { POST } = loadTs('app/api/image/route.ts');
    const run = (drawing = source) => {
      const form = new FormData(); form.set('mode', 'drawing-composite'); form.set('prompt', 'background only');
      form.set('model', '@cf/black-forest-labs/flux-2-klein-4b'); form.set('image_0', new File([drawing], 'drawing.png', { type: 'image/png' }));
      return POST(new Request('http://localhost/api/image', { method: 'POST', body: form }));
    };
    const outputs = [];
    for (const scenario of [null, 'quota', 'busy']) {
      failure = scenario;
      const response = await run();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-reference-role'), 'composite');
      assert.equal(response.headers.get('x-upstream-reference-count'), '0');
      assert.equal(response.headers.get('x-background-source'), scenario ? 'local-fallback' : 'generated');
      const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 512);
      const greenPositions = [];
      for (let i = 0; i < data.length; i += 4) if (data[i] === 64 && data[i+1] === 90 && data[i+2] === 66) greenPositions.push(i);
      assert.ok(greenPositions.length > 100);
      outputs.push(greenPositions);
    }
    assert.deepEqual(outputs[0], outputs[1], 'same drawing pixels occupy the same positions across backgrounds');
    assert.deepEqual(outputs[0], outputs[2]);
    const blank = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer();
    const emptyResponse = await run(blank);
    assert.equal(emptyResponse.status, 400);
    assert.equal((await emptyResponse.json()).errorCode, 'DRAWING_EMPTY');
    assert.equal(calls, 3, 'quota and long Retry-After must not trigger an automatic retry');
    failure = 'flagged';
    const flaggedResponse = await run();
    assert.equal(flaggedResponse.status, 422, 'content flags must never use a fallback');
    assert.equal((await flaggedResponse.json()).errorCode, 'IMAGE_CONTENT_FLAGGED');
  } finally {
    global.fetch = originalFetch;
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = account;
    if (token === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = token;
  }
});

test('quota, capacity, permission and flagged responses have distinct recovery paths', () => {
  const quota = classifyImageFailure({ errors: [{ code: 3036 }] }, 429);
  assert.equal(quota.errorCode, 'IMAGE_QUOTA_EXCEEDED');
  assert.equal(quota.retryable, false);
  assert.equal(classifyImageFailure({ errors: [{ code: 3040 }] }, 429).retryable, true);
  assert.equal(classifyImageFailure({}, 403).errorCode, 'IMAGE_ACCESS_DENIED');
  const flagged = classifyImageFailure({ errors: [{ code: 3030 }] }, 200);
  assert.equal(flagged.status, 422);
  assert.equal(flagged.retryable, false);
  assert.equal(classifyImageFailure({ success: false }, 200).status, 502);
});

test('capacity retries identical inputs once; quota and uncertain network failures are never replayed', async () => {
  const originalFetch = global.fetch;
  const form = new FormData();
  form.set('input_image_0', new File(['canonical-character'], 'character.png', { type: 'image/png' }));
  let calls = 0;
  try {
    global.fetch = async (_url, options) => {
      calls++;
      assert.equal(options.body, form);
      assert.equal(await options.body.get('input_image_0').text(), 'canonical-character');
      return calls === 1
        ? Response.json({ success: false, errors: [{ code: 3040 }] }, { status: 429 })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    };
    const result = await fetchCloudflareImage('https://example.test', 'test-token', form, new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    calls = 0;
    global.fetch = async () => { calls++; return Response.json({ errors: [{ code: 3036 }] }, { status: 429 }); };
    await assert.rejects(fetchCloudflareImage('https://example.test', 'test-token', form, new AbortController().signal), { errorCode: 'IMAGE_QUOTA_EXCEEDED', attempts: 1 });
    assert.equal(calls, 1);
    calls = 0;
    global.fetch = async () => { calls++; throw new DOMException('timed out', 'TimeoutError'); };
    await assert.rejects(fetchCloudflareImage('https://example.test', 'test-token', form, new AbortController().signal), { errorCode: 'IMAGE_REQUEST_TIMEOUT' });
    assert.equal(calls, 1);
    calls = 0;
    global.fetch = async () => { calls++; return Response.json({ errors: [{ code: 3040 }] }, { status: 429, headers: { 'retry-after': '60' } }); };
    await assert.rejects(fetchCloudflareImage('https://example.test', 'test-token', form, new AbortController().signal), { errorCode: 'IMAGE_SERVICE_BUSY' });
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});

test('cropping preserves every source pixel, including white and transparent areas', () => {
  const width = 100, height = 100;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  // Dark outline surrounding a white body.
  for (const [x, y] of [[35, 35], [64, 64]]) {
    pixels.set([30, 50, 80, 255], (y * width + x) * 4);
  }
  pixels.set([240, 230, 220, 0], 0);
  const original = pixels.slice();
  const bounds = drawingBounds(pixels, width, height);
  assert.deepEqual(pixels, original);
  assert.ok(bounds.left < 35 && bounds.top < 35);
  assert.ok(bounds.left + bounds.width > 64 && bounds.top + bounds.height > 64);
  assert.deepEqual(drawingBounds(new Uint8ClampedArray(16), 2, 2), { left: 0, top: 0, width: 2, height: 2 });
});

test('generated illustrations never compete with an original drawing', () => {
  const drawing = {}, wrongPreviousPage = {}, fallback = {};
  assert.deepEqual(sceneReferences(drawing, wrongPreviousPage, fallback), [drawing]);
  assert.deepEqual(sceneReferences(null, wrongPreviousPage, fallback), [wrongPreviousPage]);
  assert.deepEqual(sceneReferences(null, null, null), []);
  const prompt = drawingScenePrompt('waves beside a tree', 'a blue bird');
  assert.match(prompt, /input image 0/);
  assert.match(prompt, /appears once/);
  assert.doesNotMatch(prompt, /\b(girl|boy|kid)\b/i, 'never prime the model with substitute heroes');
  assert.match(prompt, /a blue bird/, 'fixed supporting cast is included');
  assert.match(prompt, /pose, body and facial expression/);
  assert.match(prompt, /waves beside a tree/);
});

test('a page that drops the drawn hero is retried, then the original drawing is pasted onto a background plate', async () => {
  const sharp = require('sharp');
  const originalFetch = global.fetch;
  const saved = { a: process.env.CLOUDFLARE_ACCOUNT_ID, t: process.env.CLOUDFLARE_API_TOKEN, g: process.env.GEMINI_API_KEY };
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'; process.env.CLOUDFLARE_API_TOKEN = 'test-token'; process.env.GEMINI_API_KEY = 'test-key';
  const page = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#c0ddee' } }).png().toBuffer();
  const prompts = []; const refs = []; let checks = 0; let verdict = false;
  global.fetch = async (url, options) => {
    if (String(url).includes('generativelanguage')) {
      checks++;
      return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ present: verdict }) }] } }] });
    }
    prompts.push(options.body.get('prompt'));
    refs.push([options.body.has('input_image_0'), options.body.has('input_image_1')]);
    return new Response(page, { headers: { 'content-type': 'image/png' } });
  };
  try {
    const { POST } = loadTs('app/api/image/route.ts');
    const drawing = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/><circle cx="32" cy="32" r="18" fill="#f06" /></svg>')).png().toBuffer();
    const form = () => {
      const f = new FormData();
      f.set('mode', 'drawing-scene'); f.set('prompt', 'first try'); f.set('retryPrompt', 'second try'); f.set('backgroundPrompt', 'plate only');
      f.set('image_0', new File([drawing], 'drawing.png', { type: 'image/png' }));
      f.set('scene_ref', new File([page], 'previous.png', { type: 'image/png' }));
      return f;
    };
    const failed = await POST(new Request('http://localhost/api/image', { method: 'POST', body: form() }));
    assert.equal(failed.status, 200);
    assert.deepEqual(prompts, ['first try', 'second try', 'plate only']);
    assert.deepEqual(refs, [[true, true], [true, true], [false, false]], 'previous page is a secondary reference; plate has none');
    assert.equal(checks, 2);
    assert.equal(failed.headers.get('x-protagonist-check'), 'composite');
    assert.equal(failed.headers.get('x-reference-role'), 'composite');

    prompts.length = 0; checks = 0; verdict = true;
    const passed = await POST(new Request('http://localhost/api/image', { method: 'POST', body: form() }));
    assert.deepEqual(prompts, ['first try']);
    assert.equal(passed.headers.get('x-protagonist-check'), 'pass');
    assert.equal(passed.headers.get('x-reference-role'), 'model');
  } finally {
    global.fetch = originalFetch;
    for (const [k, v] of [['CLOUDFLARE_ACCOUNT_ID', saved.a], ['CLOUDFLARE_API_TOKEN', saved.t], ['GEMINI_API_KEY', saved.g]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('drawing route requires the original and forwards it as input_image_0', async () => {
  const originalFetch = global.fetch;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  let forwarded;
  let upstreamUrl;
  global.fetch = async (url, options) => {
    upstreamUrl = url;
    forwarded = options.body;
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const { POST } = loadTs('app/api/image/route.ts');
    const invoke = (body) => POST(new Request('http://localhost/api/image', { method: 'POST', body }));
    const form = new FormData();
    form.set('mode', 'drawing-scene'); form.set('prompt', 'test scene');
    const missing = await invoke(form);
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).errorCode, 'DRAWING_REFERENCE_REQUIRED');
    assert.equal(forwarded, undefined);
    const drawingBytes = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/><circle cx="32" cy="32" r="18" fill="none" stroke="#405a42" stroke-width="4"/></svg>')).png().toBuffer();
    form.set('image_0', new File([drawingBytes], 'drawing.png', { type: 'image/png' }));
    form.set('image_1', new File(['wrong-page'], 'page.png', { type: 'image/png' }));
    assert.equal((await (await invoke(form)).json()).errorCode, 'DRAWING_REFERENCE_CONFLICT');
    assert.equal(forwarded, undefined);
    form.delete('image_1');
    form.set('model', '@cf/black-forest-labs/flux-2-klein-4b');
    const success = await invoke(form);
    assert.equal(success.status, 200);
    assert.ok(upstreamUrl.endsWith('/flux-2-klein-4b'));
    assert.equal(success.headers.get('x-image-model'), '@cf/black-forest-labs/flux-2-klein-4b');
    assert.equal(success.headers.get('x-reference-count'), '1');
    assert.equal(success.headers.get('x-reference-sha256'), require('node:crypto').createHash('sha256').update(drawingBytes).digest('hex'));
    assert.equal(success.headers.get('x-reference-role'), 'model');
    // The model gets the cleaned cutout on white paper, not the raw upload.
    const sent = await require('sharp')(Buffer.from(await forwarded.get('input_image_0').arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    assert.equal(sent.info.width, 512);
    assert.deepEqual([...sent.data.slice(0, 3)], [255, 255, 255]);
    assert.match(forwarded.get('prompt'), /test scene/);
    assert.equal(forwarded.has('input_image_1'), false);
    forwarded = undefined;
    form.set('model', 'untrusted/model');
    assert.equal((await (await invoke(form)).json()).errorCode, 'IMAGE_MODEL_INVALID');
    assert.equal(forwarded, undefined);
  } finally {
    global.fetch = originalFetch;
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = account;
    if (token === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = token;
  }
});

test('transparent unpainted interiors and small outline gaps become white without changing paint', () => {
  const width = 120, height = 120;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 20; y <= 100; y++) for (let x = 20; x <= 100; x++) {
    if ((x === 20 || x === 100 || y === 20 || y === 100) && !(x === 20 && y >= 48 && y <= 52))
      pixels.set([64, 90, 66, 255], (y * width + x) * 4);
  }
  pixels.set([220, 50, 80, 255], (60 * width + 60) * 4);
  const original = pixels.slice();
  const output = removeExteriorPaper(pixels, width, height);
  assert.deepEqual(pixels, original);
  assert.deepEqual(output.slice((55 * width + 55) * 4, (55 * width + 55) * 4 + 4), new Uint8ClampedArray([255,255,255,255]));
  assert.equal(output[3], 0);
  for (let i=0; i<pixels.length; i+=4) if (pixels[i+3]) assert.deepEqual(output.slice(i,i+4), pixels.slice(i,i+4));
});

test('composition size changes while the baseline and white interior stay intact', async () => {
  const sharp = require('sharp');
  const { composeDrawing } = loadTs('lib/image/compose-drawing.ts');
  const drawing = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><path d="M20 48 V20 H100 V100 H20 V53" fill="none" stroke="#405a42" stroke-width="3"/></svg>')).png().toBuffer();
  const background = await sharp({create:{width:512,height:512,channels:3,background:'#aaccee'}}).png().toBuffer();
  let previousCount = 0;
  for (const scale of [0.5, 1, 1.5]) {
    const output = await composeDrawing(background, new File([drawing], 'drawing.png', {type:'image/png'}), scale);
    const {data,info} = await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let count=0,bottom=0;
    for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
      const i=(y*info.width+x)*4;
      if(data[i]===255 && data[i+1]===255 && data[i+2]===255) count++;
      if(data[i]!==170 || data[i+1]!==204 || data[i+2]!==238) bottom=Math.max(bottom,y);
    }
    assert.ok(count > previousCount, 'larger scale must increase opaque white body area');
    assert.ok(bottom >= 433 && bottom <= 436, 'feet stay at the same baseline');
    previousCount=count;
  }
});

test('only 4B is selectable, even with a stale model environment override', async () => {
  const { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, isImageModel } = loadTs('lib/image/image-models.ts');
  assert.deepEqual(IMAGE_MODELS, ['@cf/black-forest-labs/flux-2-klein-4b']);
  for(const model of ['gemini-nano-banana-2.1','gemini-3-pro-image','@cf/black-forest-labs/flux-2-klein-9b']) assert.equal(isImageModel(model), false);
  const previous=process.env.STORY_IMAGE_MODEL, fetch=global.fetch;
  const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN;
  process.env.STORY_IMAGE_MODEL='@cf/black-forest-labs/flux-2-klein-9b';
  process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.CLOUDFLARE_API_TOKEN='test-token';
  global.fetch=async url => {assert.ok(url.endsWith('/flux-2-klein-4b'));return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});};
  try {
    const form=new FormData();form.set('prompt','test');
    const { POST }=loadTs('app/api/image/route.ts');
    const response=await POST(new Request('http://localhost/api/image',{method:'POST',body:form}));
    assert.equal(response.headers.get('x-image-model'), DEFAULT_IMAGE_MODEL);
  } finally {
    global.fetch=fetch;
    for(const [key,value] of [['STORY_IMAGE_MODEL',previous],['CLOUDFLARE_ACCOUNT_ID',account],['CLOUDFLARE_API_TOKEN',token]]) {
      if(value===undefined) delete process.env[key];else process.env[key]=value;
    }
  }
});

module.exports = { loadTs };

test('photo of grey, unevenly lit paper: paper and table edge removed, interior white', () => {
  const width = 200, height = 160;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shade = 150 + Math.round(60 * x / width); // paper photographed with a shadow gradient
    pixels.set([shade, shade - 6, shade - 18, 255], (y * width + x) * 4);
    if (x < 8) pixels.set([60, 40, 30, 255], (y * width + x) * 4); // table showing at the left edge
  }
  for (let y = 40; y <= 120; y++) for (let x = 60; x <= 140; x++) {
    const d = Math.hypot(x - 100, y - 80);
    if (d >= 34 && d <= 38) pixels.set([20, 20, 20, 255], (y * width + x) * 4);
  }
  pixels.set([90, 80, 70, 255], (10 * width + 180) * 4); // speck of dust
  const output = removeExteriorPaper(pixels, width, height);
  const at = (x, y) => [...output.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.equal(at(30, 20)[3], 0, 'grey paper outside becomes transparent');
  assert.equal(at(190, 150)[3], 0, 'bright paper outside becomes transparent');
  assert.equal(at(3, 80)[3], 0, 'table at the picture edge is dropped');
  assert.equal(at(180, 10)[3], 0, 'dust speck is dropped');
  assert.deepEqual(at(100, 80), [255, 255, 255, 255], 'inside of the character is white');
  assert.equal(at(100, 44)[3], 255, 'outline is kept');
  assert.ok(at(100, 44)[0] < 80, 'outline stays dark');
});
