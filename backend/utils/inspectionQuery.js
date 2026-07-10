function isMissingInspectionTableError(err) {
  const msg = (err && err.message) || '';
  return msg.includes('inspection_item') && msg.includes('does not exist');
}

function buildInspectionSelectQuery({ whereClause, orderBy, useInspectionPhoto, useExtendedLevel, useProcessType }) {
  const levelCols = useExtendedLevel
    ? `lm.point1_left_mm, lm.point1_right_mm, lm.point2_left_mm, lm.point2_right_mm,
       lm.point3_left_mm, lm.point3_right_mm, lm.point4_left_mm, lm.point4_right_mm,
       lm.reference_mm,`
    : '';
  const processCol = useProcessType ? 'am.process_type,' : '';
  const photoSub = useInspectionPhoto
    ? `(SELECT json_agg(json_build_object('id', ip.id, 'file_url', ip.file_url, 'caption', ip.caption, 'sort_order', ip.sort_order) ORDER BY ip.sort_order)
         FROM inspection_photo ip WHERE ip.item_id = ii.id) as inspection_photos`
    : 'NULL::json as inspection_photos';

  return `
    SELECT
      ii.*,
      ${processCol}
      am.tvoc, am.hcho, am.co2, am.unit_tvoc, am.unit_hcho,
      rm.radon, rm.unit_radon,
      lm.left_mm, lm.right_mm,
      ${levelCols}
      (SELECT json_agg(json_build_object('file_url', tp.file_url, 'caption', tp.caption, 'shot_at', tp.shot_at))
       FROM thermal_photo tp WHERE tp.item_id = ii.id) as thermal_photos,
      ${photoSub}
    FROM inspection_item ii
    LEFT JOIN air_measure am ON ii.id = am.item_id
    LEFT JOIN radon_measure rm ON ii.id = rm.item_id
    LEFT JOIN level_measure lm ON ii.id = lm.item_id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
  `;
}

function normalizeLevelItem(item) {
  if (!item || item.type !== 'level') return item;
  return {
    ...item,
    reference_mm: item.reference_mm ?? item.level_reference_mm ?? 150,
    point1_left_mm: item.point1_left_mm ?? item.left_mm,
    point1_right_mm: item.point1_right_mm ?? item.right_mm,
    point2_left_mm: item.point2_left_mm,
    point2_right_mm: item.point2_right_mm,
    point3_left_mm: item.point3_left_mm,
    point3_right_mm: item.point3_right_mm,
    point4_left_mm: item.point4_left_mm,
    point4_right_mm: item.point4_right_mm,
    left_mm: item.left_mm,
    right_mm: item.right_mm,
  };
}

function toPhotoArr(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function attachPhotos(row) {
  const item = normalizeLevelItem({ ...row });
  const inspectionPhotos = toPhotoArr(row.inspection_photos);
  const thermalPhotos = toPhotoArr(row.thermal_photos);
  item.photos = [...inspectionPhotos, ...thermalPhotos].filter(
    (p) => p && (p.file_url || p.url || p.thumb_url)
  );
  delete item.thermal_photos;
  delete item.inspection_photos;
  return item;
}

function groupInspectionRows(rows, { fixedTypes } = {}) {
  if (fixedTypes) {
    const grouped = { visual: [], thermal: [], air: [], radon: [], level: [] };
    (rows || []).forEach((row) => {
      const type = row.type || 'thermal';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(attachPhotos(row));
    });
    return grouped;
  }

  return (rows || []).reduce((acc, row) => {
    const item = attachPhotos(row);
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});
}

async function queryInspectionRows(pool, { whereClause, params, orderBy }) {
  const attempts = [
    { useInspectionPhoto: true, useExtendedLevel: true, useProcessType: true },
    { useInspectionPhoto: false, useExtendedLevel: true, useProcessType: true },
    { useInspectionPhoto: false, useExtendedLevel: false, useProcessType: false },
  ];

  let lastErr;
  for (const opts of attempts) {
    try {
      const sql = buildInspectionSelectQuery({ ...opts, whereClause, orderBy });
      return await pool.query(sql, params);
    } catch (err) {
      lastErr = err;
      if (isMissingInspectionTableError(err)) {
        return { rows: [] };
      }
      console.warn(
        `Inspection query fallback (photo=${opts.useInspectionPhoto}, level=${opts.useExtendedLevel}, process=${opts.useProcessType}):`,
        err.message
      );
    }
  }

  if (lastErr && isMissingInspectionTableError(lastErr)) {
    return { rows: [] };
  }
  throw lastErr;
}

module.exports = {
  queryInspectionRows,
  groupInspectionRows,
  attachPhotos,
  normalizeLevelItem,
};
