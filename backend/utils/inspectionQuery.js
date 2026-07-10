function isMissingTableError(err, tableName) {
  const msg = (err && err.message) || '';
  return msg.includes(tableName) && msg.includes('does not exist');
}

function isMissingInspectionTableError(err) {
  return isMissingTableError(err, 'inspection_item');
}

function buildInspectionSelectQuery({ whereClause, orderBy, useExtendedLevel, useProcessType, useThermalPhoto }) {
  const levelCols = useExtendedLevel
    ? `lm.point1_left_mm, lm.point1_right_mm, lm.point2_left_mm, lm.point2_right_mm,
       lm.point3_left_mm, lm.point3_right_mm, lm.point4_left_mm, lm.point4_right_mm,
       lm.reference_mm,`
    : '';
  const processCol = useProcessType ? 'am.process_type,' : '';
  const thermalSub = useThermalPhoto
    ? `(SELECT json_agg(json_build_object('file_url', tp.file_url, 'caption', tp.caption, 'shot_at', tp.shot_at))
         FROM thermal_photo tp WHERE tp.item_id = ii.id) as thermal_photos`
    : 'NULL::json as thermal_photos';

  return `
    SELECT
      ii.*,
      ${processCol}
      am.tvoc, am.hcho, am.co2, am.unit_tvoc, am.unit_hcho,
      rm.radon, rm.unit_radon,
      lm.left_mm, lm.right_mm,
      ${levelCols}
      ${thermalSub}
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

async function loadInspectionPhotosForItems(pool, itemIds) {
  if (!itemIds.length) return {};
  try {
    const result = await pool.query(
      `SELECT id, item_id, file_url, caption, sort_order
       FROM inspection_photo
       WHERE item_id = ANY($1::text[])
       ORDER BY sort_order ASC, created_at ASC`,
      [itemIds]
    );
    const map = {};
    for (const row of result.rows) {
      if (!map[row.item_id]) map[row.item_id] = [];
      map[row.item_id].push({
        id: row.id,
        file_url: row.file_url,
        caption: row.caption,
        sort_order: row.sort_order,
      });
    }
    return map;
  } catch (err) {
    if (isMissingTableError(err, 'inspection_photo')) {
      return {};
    }
    throw err;
  }
}

async function enrichRowsWithPhotos(pool, rows) {
  const itemIds = (rows || []).map((r) => r.id).filter(Boolean);
  const photoMap = await loadInspectionPhotosForItems(pool, itemIds);
  return (rows || []).map((row) => {
    const fromDb = photoMap[row.id];
    if (!fromDb || fromDb.length === 0) return row;
    const existing = toPhotoArr(row.inspection_photos);
    if (existing.length > 0) return row;
    return { ...row, inspection_photos: fromDb };
  });
}

async function queryInspectionRows(pool, { whereClause, params, orderBy }) {
  const attempts = [
    { useExtendedLevel: true, useProcessType: true, useThermalPhoto: true },
    { useExtendedLevel: true, useProcessType: false, useThermalPhoto: true },
    { useExtendedLevel: false, useProcessType: false, useThermalPhoto: false },
  ];

  let lastErr;
  for (const opts of attempts) {
    try {
      const sql = buildInspectionSelectQuery({ ...opts, whereClause, orderBy });
      const result = await pool.query(sql, params);
      result.rows = await enrichRowsWithPhotos(pool, result.rows);
      return result;
    } catch (err) {
      lastErr = err;
      if (isMissingInspectionTableError(err)) {
        return { rows: [] };
      }
      console.warn(
        `Inspection query fallback (level=${opts.useExtendedLevel}, process=${opts.useProcessType}, thermal=${opts.useThermalPhoto}):`,
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
  loadInspectionPhotosForItems,
};
