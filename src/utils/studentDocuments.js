/**
 * Issue #3: admission/student documents are grouped by document type and each
 * group keeps an additive `files[]` list. Legacy records (one file described by
 * top-level storageKey/fileName fields) are still read correctly, and the first
 * file is mirrored to those old fields when saving so older screens keep working.
 */

const META_FIELDS = ['storageKey', 'fileName', 'fileType', 'fileSize', 'uploadedAt', 'status'];

export const docGroupKey = (doc) => String(doc?.docTypeId || doc?.name || doc?.docType || 'Document').trim().toLowerCase();

export function fileFromLegacy(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const storageKey = doc.storageKey || doc.fileKey || null;
  if (!storageKey && !doc.fileName) return null;
  return {
    id: doc.fileId || storageKey || `${doc.name || 'doc'}_${doc.fileName || 'file'}`,
    storageKey,
    fileName: doc.fileName || doc.name || 'Document',
    fileType: doc.fileType || doc.type || '',
    fileSize: doc.fileSize ?? doc.size ?? null,
    uploadedAt: doc.uploadedAt || null,
    status: doc.status || 'Submitted',
  };
}

export function normalizeDocGroup(doc) {
  if (!doc) return null;
  if (typeof doc === 'string') {
    return { name: doc, docTypeId: doc, files: [] };
  }
  const name = doc.name || doc.docType || 'Document';
  const docTypeId = doc.docTypeId || doc.typeId || name;
  let files = Array.isArray(doc.files) ? doc.files.filter(Boolean).map((f, i) => ({
    ...f,
    id: f.id || f.storageKey || `${docTypeId}_${i}`,
    storageKey: f.storageKey || f.id || null,
    fileName: f.fileName || f.name || 'Document',
    fileType: f.fileType || f.type || '',
    fileSize: f.fileSize ?? f.size ?? null,
  })) : [];
  // A row may have both `files[]` and an older top-level file. Keep the older
  // file too unless it is the same physical file, so migration never loses one.
  const legacy = fileFromLegacy(doc);
  if (legacy) {
    const seenKeys = new Set(files.map((f) => f.storageKey || f.id).filter(Boolean));
    const sameFile = legacy.storageKey
      ? seenKeys.has(legacy.storageKey)
      : files.some((f) => f.fileName === legacy.fileName && (f.fileSize ?? null) === (legacy.fileSize ?? null));
    if (!sameFile) files = [...files, legacy];
  }
  return { ...doc, name, docTypeId, files };
}

const lower = (v) => String(v ?? '').trim().toLowerCase();
const groupAliases = (group) => [...new Set([group?.name, group?.docTypeId, group?.typeId].map(lower).filter(Boolean))];
const groupMatches = (group, docKey) => groupAliases(group).includes(lower(docKey));

/**
 * Merge legacy per-file doc rows into one group per document type, preserving order.
 * Rows match when either their stable id or their display name agrees, so a legacy
 * `name` row still joins a newer `docTypeId` row (and vice versa).
 */
export function groupStudentDocuments(docs) {
  const groups = [];
  const byAlias = new Map();
  for (const raw of Array.isArray(docs) ? docs : []) {
    const group = normalizeDocGroup(raw);
    if (!group) continue;
    const existing = groupAliases(group).map((key) => byAlias.get(key)).find(Boolean);
    if (!existing) {
      groups.push(group);
      for (const key of groupAliases(group)) byAlias.set(key, group);
      continue;
    }
    // Same type: append files instead of replacing siblings.
    const seen = new Set(existing.files.map((f) => f.id || f.storageKey).filter(Boolean));
    for (const f of group.files) {
      const fid = f.id || f.storageKey;
      if (!fid || !seen.has(fid)) { existing.files.push(f); if (fid) seen.add(fid); }
    }
    if (!existing.name && group.name) existing.name = group.name;
    // Prefer a real id over the old "id was the display name" convention so
    // later calls by either the name or the id still find the same type.
    if (group.docTypeId && group.docTypeId !== group.name && (!existing.docTypeId || existing.docTypeId === existing.name)) {
      existing.docTypeId = group.docTypeId;
    }
    if (!existing.docTypeId && group.docTypeId) existing.docTypeId = group.docTypeId;
    for (const field of META_FIELDS) if (existing[field] == null && group[field] != null) existing[field] = group[field];
    for (const key of [...groupAliases(existing), ...groupAliases(group)]) byAlias.set(key, existing);
  }
  return groups;
}

/** Idempotent legacy -> `files[]` migration. Existing groups are returned unchanged apart from merging. */
export const migrateLegacyDocuments = (docs) => groupStudentDocuments(docs);

/** Mirror the first file to the legacy top-level fields while keeping files[]. */
export function withLegacyMirror(group) {
  const first = group?.files?.[0];
  if (!first) return { ...group, files: group?.files || [] };
  return {
    ...group,
    files: group.files,
    storageKey: first.storageKey || null,
    fileName: first.fileName || first.name || null,
    fileType: first.fileType || first.type || '',
    fileSize: first.fileSize ?? first.size ?? null,
    uploadedAt: first.uploadedAt || null,
    status: first.status || group.status || 'Submitted',
  };
}

export function findDocumentGroup(docs, docKey) {
  return groupStudentDocuments(docs).find((g) => groupMatches(g, docKey)) || null;
}

/** Append files to a document type without touching any other file/type. */
export function addFilesToDocuments(docs, { name, docTypeId, files = [] }) {
  const groups = groupStudentDocuments(docs);
  const wanted = docTypeId || name || 'Document';
  let group = groups.find((g) => groupMatches(g, wanted) || (name && groupMatches(g, name)));
  if (!group) {
    group = { name: name || docTypeId || 'Document', docTypeId: docTypeId || name || 'Document', files: [] };
    groups.push(group);
  }
  // Record a real stable id when the existing group only knew the display name.
  if (docTypeId && docTypeId !== group.docTypeId && (!group.docTypeId || group.docTypeId === group.name || group.docTypeId === name)) {
    group.docTypeId = docTypeId;
  }
  group.files = [...group.files, ...files];
  return groups.map((g) => (g === group ? withLegacyMirror(g) : withLegacyMirror(g)));
}

/** Replace exactly one file inside one type; sibling files and other types are untouched. */
export function replaceDocumentFile(docs, docKey, fileId, nextFile) {
  const targetId = String(fileId || '');
  return groupStudentDocuments(docs).map((group) => {
    if (!groupMatches(group, docKey)) return withLegacyMirror(group);
    return withLegacyMirror({
      ...group,
      files: group.files.map((f) => (String(f.id || f.storageKey) === targetId ? { ...nextFile } : f)),
    });
  });
}

/** Remove exactly one file; the group is dropped only when it has no files left. */
export function removeDocumentFile(docs, docKey, fileId) {
  const targetId = String(fileId || '');
  return groupStudentDocuments(docs)
    .map((group) => {
      if (!groupMatches(group, docKey)) return withLegacyMirror(group);
      return withLegacyMirror({ ...group, files: group.files.filter((f) => String(f.id || f.storageKey) !== targetId) });
    })
    .filter((group) => group.files.length > 0);
}

/** Rename only the document-type label, never files. */
export function renameDocumentGroup(docs, docKey, name) {
  return groupStudentDocuments(docs).map((group) => (
    groupMatches(group, docKey) ? withLegacyMirror({ ...group, name: name || group.name }) : withLegacyMirror(group)
  ));
}

export function allDocumentFiles(docs) {
  return groupStudentDocuments(docs).flatMap((g) => g.files.map((f) => ({ ...f, name: g.name, docTypeId: g.docTypeId })));
}
