// JSON 본문을 읽고 검증한다. 실패하면 그대로 돌려줄 400 응답, 성공하면 검증된 값을 준다.
export async function readJsonBody<T>(request: Request, parse: (raw: unknown) => T | string): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const parsed = parse(raw);
  return typeof parsed === "string" ? Response.json({ error: parsed }, { status: 400 }) : parsed;
}
