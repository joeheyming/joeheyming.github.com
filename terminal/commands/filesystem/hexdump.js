// hexdump command - debug file contents showing raw bytes and escape sequences
import { VfsUtils } from '../../lib/vfs-utils.js';

async function hexdumpHandler(terminal, args) {
  if (args.length === 0) {
    return { stderr: 'hexdump: missing operand', exitCode: 1 };
  }

  const displayPath = args[0];
  const filePath = terminal.resolvePath(displayPath);
  const item = await terminal.getFileSystemItem(filePath);

  if (!item) {
    return {
      stderr: `hexdump: ${displayPath}: No such file or directory`,
      exitCode: 1
    };
  }

  if (item.type !== 'file') {
    return {
      stderr: `hexdump: ${displayPath}: Is a directory`,
      exitCode: 1
    };
  }

  const d = VfsUtils.fileItemUtf8ForDisplay(item);
  const content = d.isBinary ? '' : d.text;
  const byteLen =
    item.contentBytes instanceof ArrayBuffer
      ? item.contentBytes.byteLength
      : ArrayBuffer.isView(item.contentBytes)
      ? item.contentBytes.byteLength
      : content.length;
  let result = `File: ${displayPath} (${byteLen} bytes${d.isBinary ? ', binary' : ''})\n`;
  result += `Raw content: "${content}"\n`;
  result += `Escaped: ${JSON.stringify(content)}\n`;
  result += `Char codes: [${Array.from(content)
    .map((c) => c.charCodeAt(0))
    .join(', ')}]`;

  return { stdout: result, stderr: '', exitCode: 0 };
}

export default {
  name: 'hexdump',
  handler: hexdumpHandler,
  description: 'debug file contents showing raw bytes and escape sequences',
  category: 'File System'
};
