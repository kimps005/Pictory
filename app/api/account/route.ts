import { createClient } from "@supabase/supabase-js";

export async function DELETE(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return Response.json({ error: "로그인 정보가 필요해요." }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return Response.json({ error: "계정 탈퇴 설정이 완료되지 않았어요. 관리자에게 문의해 주세요." }, { status: 503 });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !user) return Response.json({ error: "로그인 정보가 만료됐어요. 다시 로그인해 주세요." }, { status: 401 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[/api/account] account deletion failed", error);
    return Response.json({ error: "계정을 탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  // user_data.user_id의 ON DELETE CASCADE가 동화·마음 기록·설정을 함께 삭제한다.
  return Response.json({ ok: true });
}
