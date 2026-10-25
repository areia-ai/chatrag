import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMultiTenant } from '@/lib/deployment-mode';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isMultiTenant()) {
    return NextResponse.json(
      { error: 'Feature not available in single-tenant mode' },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Await params before accessing properties (Next.js 15+ requirement)
  const { id } = await params;

  // Check if user is member of organization
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', id)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  // Fetch organization settings
  const { data: org, error } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    systemPrompt: org.settings?.systemPrompt || null
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isMultiTenant()) {
    return NextResponse.json(
      { error: 'Feature not available in single-tenant mode' },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Await params before accessing properties (Next.js 15+ requirement)
  const { id } = await params;

  // Check if user is owner or admin
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', id)
    .eq('user_id', user.id)
    .single();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only owners and admins can edit settings' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { systemPrompt } = body;

  // Basic validation - at least one field should have content if enabled
  if (systemPrompt?.enabled && !systemPrompt?.preContext?.trim() && !systemPrompt?.postContext?.trim()) {
    return NextResponse.json(
      { error: 'Please provide at least some instructions in pre-context or post-context' },
      { status: 400 }
    );
  }

  // Fetch current settings
  const { data: currentOrg } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', id)
    .single();

  // Merge new systemPrompt settings with existing settings
  const updatedSettings = {
    ...(currentOrg?.settings || {}),
    systemPrompt: {
      ...systemPrompt,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id
    }
  };

  // Update organization settings
  const { error } = await supabase
    .from('organizations')
    .update({
      settings: updatedSettings
    })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
