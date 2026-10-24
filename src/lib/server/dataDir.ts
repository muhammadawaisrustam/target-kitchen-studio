import path from "node:path";

/** Folder for data written while the app runs (enquiries, admin imports). Not part of the build. */
export const dataDir = () => path.resolve(process.cwd(), process.env.DATA_DIR || ".data");
