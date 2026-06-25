// Defensive strip of any legacy "brassbell-" prefix from a bare slug.
function bbSlug(slug) {
  return String(slug || '').replace(/^brassbell-/, '');
}

// The authoritative brassbell.net URL slug is the last path segment of
// units.source_url (e.g. ".../property/brassbell-l-sh-zayed-.../" ->
// "brassbell-l-sh-zayed-..."). The DB `slug` is sometimes a cleaned-up variant
// that does NOT resolve on brassbell.net, so source_url wins when present.
function slugFromSourceUrl(sourceUrl, fallbackSlug) {
  const m = String(sourceUrl || '').match(/\/property\/([^/?#]+)\/?(?:[?#]|$)/);
  if (m && m[1]) return m[1];
  return bbSlug(fallbackSlug);
}

async function loadBrassbellUnits(sb) {
  const { data, error } = await sb
    .from('units')
    .select('wp_post_id, slug, title, area, source_url')
    .eq('source', 'brassbell')
    .eq('status', 'published')
    .order('wp_post_id', { ascending: true });
  if (error) throw new Error(`loadBrassbellUnits: ${error.message}`);
  return (data || []).map((u) => ({
    wp: u.wp_post_id,
    slug: u.slug,
    bbSlug: slugFromSourceUrl(u.source_url, u.slug),
    title: u.title || u.slug,
    area: u.area || '',
  }));
}

module.exports = { bbSlug, slugFromSourceUrl, loadBrassbellUnits };
