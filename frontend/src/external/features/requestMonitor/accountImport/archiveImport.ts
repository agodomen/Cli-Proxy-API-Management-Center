export type ImportTextFile = {
  name: string;
  text: string;
};

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
};

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

const MAX_ZIP_FILE_BYTES = 500_000_000;
const MAX_ZIP_JSON_FILES = 50_000;
const MAX_ZIP_EXTRACTED_JSON_BYTES = 500_000_000;
const MAX_ZIP_SINGLE_JSON_BYTES = 50_000_000;

const textDecoder = new TextDecoder('utf-8');

const isZipFile = (file: File) => {
  const name = file.name.toLowerCase();
  return name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
};

const normalizeZipPath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '');

const isIgnoredZipPath = (path: string) => {
  const normalized = normalizeZipPath(path);
  const parts = normalized.split('/');
  const baseName = parts[parts.length - 1] ?? '';
  return (
    !normalized ||
    normalized.endsWith('/') ||
    normalized.includes('../') ||
    normalized.startsWith('__MACOSX/') ||
    baseName.startsWith('._') ||
    !normalized.toLowerCase().endsWith('.json')
  );
};

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
};

const readZipEntries = (buffer: ArrayBuffer): ZipEntry[] => {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('Invalid ZIP file');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ZIP central directory');
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const name = normalizeZipPath(textDecoder.decode(new Uint8Array(buffer, fileNameStart, fileNameLength)));

    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    offset = fileNameEnd + extraLength + commentLength;
  }

  return entries;
};

const readEntryCompressedData = (buffer: ArrayBuffer, entry: ZipEntry) => {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP entry: ${entry.name}`);
  }

  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > view.byteLength) throw new Error(`Invalid ZIP entry size: ${entry.name}`);
  return buffer.slice(dataStart, dataEnd);
};

const inflateRaw = async (data: ArrayBuffer) => {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('ZIP deflate decompression is not supported by this browser');
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).arrayBuffer();
};

const extractEntry = async (buffer: ArrayBuffer, entry: ZipEntry) => {
  if (entry.uncompressedSize > MAX_ZIP_SINGLE_JSON_BYTES) {
    throw new Error(`ZIP entry exceeds 50MB limit: ${entry.name}`);
  }

  const compressedData = readEntryCompressedData(buffer, entry);
  if (entry.compressionMethod === 0) return compressedData;
  if (entry.compressionMethod === 8) return await inflateRaw(compressedData);
  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}: ${entry.name}`);
};

export const loadZipJsonFiles = async (file: File): Promise<ImportTextFile[]> => {
  if (file.size > MAX_ZIP_FILE_BYTES) throw new Error(`ZIP file exceeds ${Math.floor(MAX_ZIP_FILE_BYTES / 1_000_000)}MB size limit`);

  const buffer = await file.arrayBuffer();
  const jsonEntries = readZipEntries(buffer).filter((entry) => !isIgnoredZipPath(entry.name));
  if (jsonEntries.length === 0) throw new Error('ZIP file does not contain JSON files');
  if (jsonEntries.length > MAX_ZIP_JSON_FILES) {
    throw new Error(
      `ZIP file contains too many JSON files (${jsonEntries.length} > ${MAX_ZIP_JSON_FILES})`
    );
  }

  let totalBytes = 0;
  const files: ImportTextFile[] = [];
  for (const entry of jsonEntries) {
    totalBytes += entry.uncompressedSize;
    if (totalBytes > MAX_ZIP_EXTRACTED_JSON_BYTES) {
      throw new Error(`ZIP extracted JSON files exceed ${Math.floor(MAX_ZIP_EXTRACTED_JSON_BYTES / 1_000_000)}MB size limit`);
    }

    const content = await extractEntry(buffer, entry);
    files.push({
      name: `${file.name}/${entry.name}`,
      text: textDecoder.decode(content),
    });
  }

  return files;
};

export const loadImportFile = async (file: File): Promise<ImportTextFile[]> => {
  if (isZipFile(file)) return await loadZipJsonFiles(file);
  return [{ name: file.name, text: await file.text() }];
};
