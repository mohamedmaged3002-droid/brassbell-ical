// Brassbell URL slug = DB slug, with a defensive strip of any legacy "brassbell-" prefix.
function bbSlug(slug) {
  return String(slug || '').replace(/^brassbell-/, '');
}

async function loadBrassbellUnits(sb) {
  const { data, error } = await sb
    .from('units')
    .select('wp_post_id, slug, title')
    .eq('source', 'brassbell')
    .eq('status', 'published')
    .order('wp_post_id', { ascending: true });
  if (error) throw new Error(`loadBrassbellUnits: ${error.message}`);
  return (data || []).map((u) => ({
    wp: u.wp_post_id,
    slug: u.slug,
    bbSlug: bbSlug(u.slug),
    title: u.title || u.slug,
  }));
}

module.exports = { bbSlug, loadBrassbellUnits };
