const { describe, test, expect, beforeEach, afterEach } = require('bun:test')
const { formatToolDetails, createParser } = require('./parse-claude-stream.js')

describe('formatToolDetails', () => {
  test('formats Read tool with file_path', () => {
    const result = formatToolDetails('Read', '{"file_path": "/src/index.ts"}')
    expect(result).toBe(' /src/index.ts')
  })

  test('formats Write tool with file_path', () => {
    const result = formatToolDetails('Write', '{"file_path": "/src/output.ts"}')
    expect(result).toBe(' /src/output.ts')
  })

  test('formats Edit tool with file_path', () => {
    const result = formatToolDetails('Edit', '{"file_path": "/src/file.ts"}')
    expect(result).toBe(' /src/file.ts')
  })

  test('formats Glob tool with pattern', () => {
    const result = formatToolDetails('Glob', '{"pattern": "**/*.ts"}')
    expect(result).toBe(' **/*.ts')
  })

  test('formats Grep tool with pattern only', () => {
    const result = formatToolDetails('Grep', '{"pattern": "TODO"}')
    expect(result).toBe(' "TODO"')
  })

  test('formats Grep tool with pattern and path', () => {
    const result = formatToolDetails(
      'Grep',
      '{"pattern": "TODO", "path": "/src"}'
    )
    expect(result).toBe(' "TODO" in /src')
  })

  test('formats Bash tool with short command', () => {
    const result = formatToolDetails('Bash', '{"command": "npm test"}')
    expect(result).toBe(' npm test')
  })

  test('formats Bash tool truncates long commands', () => {
    const longCmd = 'a'.repeat(100)
    const result = formatToolDetails('Bash', `{"command": "${longCmd}"}`)
    expect(result).toBe(` ${'a'.repeat(60)}...`)
  })

  test('formats Task tool with description', () => {
    const result = formatToolDetails('Task', '{"description": "Run tests"}')
    expect(result).toBe(' Run tests')
  })

  test('formats Task tool with empty description', () => {
    const result = formatToolDetails('Task', '{}')
    expect(result).toBe(' ')
  })

  test('formats TodoWrite tool with item count', () => {
    const result = formatToolDetails(
      'TodoWrite',
      '{"todos": [{"content": "a"}, {"content": "b"}]}'
    )
    expect(result).toBe(' (2 items)')
  })

  test('formats TodoWrite tool with no todos', () => {
    const result = formatToolDetails('TodoWrite', '{}')
    expect(result).toBe(' (0 items)')
  })

  test('formats WebFetch tool with url', () => {
    const result = formatToolDetails(
      'WebFetch',
      '{"url": "https://example.com"}'
    )
    expect(result).toBe(' https://example.com')
  })

  test('formats WebSearch tool with query', () => {
    const result = formatToolDetails(
      'WebSearch',
      '{"query": "TypeScript docs"}'
    )
    expect(result).toBe(' "TypeScript docs"')
  })

  test('returns empty string for unknown tool', () => {
    const result = formatToolDetails('UnknownTool', '{}')
    expect(result).toBe('')
  })

  test('returns empty string for invalid JSON', () => {
    const result = formatToolDetails('Read', 'not valid json')
    expect(result).toBe('')
  })
})

describe('createParser', () => {
  let output
  let errorOutput
  let parser

  beforeEach(() => {
    output = {
      content: '',
      write(text) {
        this.content += text
      },
    }
    errorOutput = {
      content: '',
      write(text) {
        this.content += text
      },
    }
    parser = createParser(output, errorOutput)
  })

  describe('text streaming', () => {
    test('streams text delta content', () => {
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'text' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello ' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'World' },
          },
        })
      )
      expect(output.content).toBe('Hello World')
    })

    test('adds newline on message_stop', () => {
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_stop' },
        })
      )
      expect(output.content).toBe('\n')
    })
  })

  describe('tool use formatting', () => {
    test('displays tool with details on content_block_stop', () => {
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'tool_use', name: 'Read' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"file_path": "/test.ts"}',
            },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_stop' },
        })
      )
      expect(output.content).toBe('\n🔧 Read /test.ts\n')
    })

    test('accumulates tool input from multiple deltas', () => {
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'tool_use', name: 'Bash' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: '{"command":' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: ' "npm test"}' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_stop' },
        })
      )
      expect(output.content).toBe('\n🔧 Bash npm test\n')
    })
  })

  describe('text to tool transitions', () => {
    test('adds blank line between text and tool output', () => {
      // Start text block
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'text' },
          },
        })
      )
      // Write some text
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Some text here' },
          },
        })
      )
      // Start tool use (should add blank line)
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'tool_use', name: 'Bash' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"command": "ls"}',
            },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_stop' },
        })
      )

      // Should have: text + two newlines + tool line
      expect(output.content).toBe('Some text here\n\n\n🔧 Bash ls\n')
    })

    test('tool without preceding text has no extra spacing', () => {
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'tool_use', name: 'Read' },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"file_path": "/test"}',
            },
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_stop' },
        })
      )
      expect(output.content).toBe('\n🔧 Read /test\n')
    })
  })

  describe('assistant messages (non-streaming mode)', () => {
    test('displays text from assistant message', () => {
      parser.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello from assistant' }],
          },
        })
      )
      expect(output.content).toBe('Hello from assistant\n')
    })

    test('displays tool_use from assistant message', () => {
      parser.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }],
          },
        })
      )
      expect(output.content).toBe('\n🔧 Read\n')
    })

    test('deduplicates tool_use by id', () => {
      parser.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }],
          },
        })
      )
      parser.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read' }],
          },
        })
      )
      expect(output.content).toBe('\n🔧 Read\n')
    })

    test('ignores assistant messages when in streaming mode', () => {
      // Enter streaming mode
      parser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'text' },
          },
        })
      )
      // Now assistant message should be ignored
      parser.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Should be ignored' }],
          },
        })
      )
      expect(output.content).toBe('')
    })
  })

  describe('tool results', () => {
    test('displays done message for tool_result', () => {
      parser.processLine(JSON.stringify({ type: 'tool_result' }))
      expect(output.content).toBe('✓ Done\n\n')
    })
  })

  describe('error handling', () => {
    test('displays error message', () => {
      parser.processLine(
        JSON.stringify({
          type: 'error',
          error: { message: 'Something went wrong' },
        })
      )
      expect(errorOutput.content).toBe('❌ Error: Something went wrong\n')
    })

    test('stringifies error object without message', () => {
      parser.processLine(
        JSON.stringify({
          type: 'error',
          error: { code: 500 },
        })
      )
      expect(errorOutput.content).toBe('❌ Error: {"code":500}\n')
    })

    test('handles invalid JSON silently', () => {
      parser.processLine('not valid json')
      expect(output.content).toBe('')
      expect(errorOutput.content).toBe('')
    })
  })

  describe('user messages', () => {
    test('user messages are silently handled', () => {
      parser.processLine(
        JSON.stringify({
          type: 'user',
          message: { content: 'User input' },
        })
      )
      expect(output.content).toBe('')
    })
  })

  describe('DEBUG mode', () => {
    const originalDebug = process.env.DEBUG

    beforeEach(() => {
      process.env.DEBUG = '1'
    })

    afterEach(() => {
      if (originalDebug === undefined) {
        delete process.env.DEBUG
      } else {
        process.env.DEBUG = originalDebug
      }
    })

    test('logs debug info for stream events', () => {
      const debugOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugErrorOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugParser = createParser(debugOutput, debugErrorOutput)

      debugParser.processLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_stop' },
        })
      )

      expect(debugErrorOutput.content).toContain('[DEBUG]')
      expect(debugErrorOutput.content).toContain('type=stream_event')
      expect(debugErrorOutput.content).toContain('event=message_stop')
    })

    test('logs debug info for invalid JSON', () => {
      const debugOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugErrorOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugParser = createParser(debugOutput, debugErrorOutput)

      debugParser.processLine('invalid json here')

      expect(debugErrorOutput.content).toContain('[DEBUG] Parse fail:')
      expect(debugErrorOutput.content).toContain('invalid json here')
    })

    test('does not log debug for empty lines', () => {
      const debugOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugErrorOutput = {
        content: '',
        write(text) {
          this.content += text
        },
      }
      const debugParser = createParser(debugOutput, debugErrorOutput)

      debugParser.processLine('   ')

      expect(debugErrorOutput.content).toBe('')
    })
  })
})
