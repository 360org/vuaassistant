import path from 'path';

/**
 * Lấy thư mục dữ liệu ứng dụng.
 * Ưu tiên:
 * 1. VUA_DATA_DIR env var
 * 2. Mặc định: ~/vuaassistant
 */
export function getDataDir(): string {
  return process.env.VUA_DATA_DIR || path.join(process.env.HOME || '', 'vuaassistant');
}
