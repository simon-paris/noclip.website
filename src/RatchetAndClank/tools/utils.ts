import { type FileHandle } from "node:fs/promises";
import { DataViewExt } from "../DataViewExt";

export const SECTOR_SIZE = 0x800;

// Read byteLength bytes starting at startSector
export async function readFromDisk(disk: FileHandle, startSector: number, byteLength: number) {
  const dest = new Uint8Array(byteLength);
  await disk.read(dest, 0, byteLength, startSector * SECTOR_SIZE);
  return dest.buffer;
}

// Read the size of the object at startSector + sizeOffset and then read that many bytes starting at startSector
export async function readFromDiskWithSizeHeader(disk: FileHandle, startSector: number, sizeOffset: number) {
  const header = await readFromDisk(disk, startSector, sizeOffset + 0x4);
  const byteLength = new DataViewExt(header, { littleEndian: true }, sizeOffset).getInt32(0);
  return readFromDisk(disk, startSector, byteLength);
}
