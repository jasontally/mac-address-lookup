/** Decode a Parquet buffer off the main thread. Single-purpose worker. */

import { parquetReadObjects } from 'hyparquet';

self.onmessage = async (event) => {
  const { id, buffer } = event.data;
  try {
    const rows = await parquetReadObjects({ file: buffer });
    self.postMessage({ id, rows });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
