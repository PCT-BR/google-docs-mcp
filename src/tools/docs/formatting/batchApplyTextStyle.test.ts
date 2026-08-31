import type { FastMCP } from 'fastmcp';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const batchUpdateMock = vi.fn(async () => ({ data: {} }));
const documentsGetMock = vi.fn();

vi.mock('../../../clients.js', () => ({
  getDocsClient: vi.fn(async () => ({
    documents: {
      batchUpdate: batchUpdateMock,
      get: documentsGetMock,
    },
  })),
}));

const { register } = await import('./batchApplyTextStyle.js');

type ToolConfig = Parameters<FastMCP['addTool']>[0];

function captureTool() {
  let tool: ToolConfig | undefined;
  const server = {
    addTool: (t: ToolConfig) => {
      tool = t;
    },
  };
  register(server as unknown as FastMCP);
  if (!tool) throw new Error('Tool was not registered');
  return tool;
}

const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

describe('batchApplyTextStyle', () => {
  beforeEach(() => {
    batchUpdateMock.mockClear();
    documentsGetMock.mockClear();
  });

  it('applies all operations in a single batchUpdate call when under the chunk limit', async () => {
    const tool = captureTool();
    const result = await tool.execute(
      {
        documentId: 'doc1',
        operations: [
          { target: { startIndex: 1, endIndex: 10 }, style: { foregroundColor: '#FF0000' } },
          { target: { startIndex: 11, endIndex: 20 }, style: { bold: true } },
          { target: { startIndex: 21, endIndex: 30 }, style: { italic: true } },
        ],
      },
      { log: fakeLog } as any
    );

    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock.mock.calls[0][0].requestBody.requests).toHaveLength(3);
    expect(result).toContain('Applied 3/3');
    expect(result).toContain('in 1 Docs API call(s)');
  });

  it('chunks more than 50 operations into multiple batchUpdate calls', async () => {
    const tool = captureTool();
    const operations = Array.from({ length: 120 }, (_, i) => ({
      target: { startIndex: i * 2 + 1, endIndex: i * 2 + 2 },
      style: { bold: true },
    }));

    const result = await tool.execute({ documentId: 'doc1', operations }, { log: fakeLog } as any);

    // 120 ops / 50 per call = 3 calls (50, 50, 20)
    expect(batchUpdateMock).toHaveBeenCalledTimes(3);
    expect(batchUpdateMock.mock.calls[0][0].requestBody.requests).toHaveLength(50);
    expect(batchUpdateMock.mock.calls[1][0].requestBody.requests).toHaveLength(50);
    expect(batchUpdateMock.mock.calls[2][0].requestBody.requests).toHaveLength(20);
    expect(result).toContain('Applied 120/120');
    expect(result).toContain('in 3 Docs API call(s)');
  });

  it('skips an operation whose textToFind is not found, without failing the whole batch', async () => {
    documentsGetMock.mockResolvedValue({
      data: { body: { content: [] } }, // empty doc: nothing will be found
    });

    const tool = captureTool();
    const result = await tool.execute(
      {
        documentId: 'doc1',
        operations: [
          { target: { startIndex: 1, endIndex: 5 }, style: { bold: true } },
          { target: { textToFind: 'does not exist', matchInstance: 1 }, style: { italic: true } },
        ],
      },
      { log: fakeLog } as any
    );

    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock.mock.calls[0][0].requestBody.requests).toHaveLength(1);
    expect(result).toContain('Applied 1/2');
    expect(result).toContain('Skipped 1');
  });

  it('throws a UserError when every operation is unresolvable', async () => {
    documentsGetMock.mockResolvedValue({ data: { body: { content: [] } } });

    const tool = captureTool();
    await expect(
      tool.execute(
        {
          documentId: 'doc1',
          operations: [{ target: { textToFind: 'nope', matchInstance: 1 }, style: { bold: true } }],
        },
        { log: fakeLog } as any
      )
    ).rejects.toThrow('No operations could be applied');

    expect(batchUpdateMock).not.toHaveBeenCalled();
  });
});
