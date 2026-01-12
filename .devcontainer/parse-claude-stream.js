#!/usr/bin/env node

// Parser for Claude Code's stream-json output
// Converts streaming JSON to human-readable output

const readline = require('node:readline')

// Format tool details for display
function formatToolDetails(toolName, inputJson) {
  try {
    const input = JSON.parse(inputJson)
    switch (toolName) {
      case 'Read':
        return ` ${input.file_path}`
      case 'Write':
        return ` ${input.file_path}`
      case 'Edit':
        return ` ${input.file_path}`
      case 'Glob':
        return ` ${input.pattern}`
      case 'Grep':
        return ` "${input.pattern}"${input.path ? ` in ${input.path}` : ''}`
      case 'Bash': {
        const cmd = input.command?.slice(0, 60) || ''
        return ` ${cmd}${input.command?.length > 60 ? '...' : ''}`
      }
      case 'Task':
        return ` ${input.description || ''}`
      case 'TodoWrite': {
        const count = input.todos?.length || 0
        return ` (${count} items)`
      }
      case 'WebFetch':
        return ` ${input.url}`
      case 'WebSearch':
        return ` "${input.query}"`
      default:
        return ''
    }
  } catch {
    return ''
  }
}

// Create a parser instance with injectable output
function createParser(output = process.stdout, errorOutput = process.stderr) {
  let inTextBlock = false
  const seenToolIds = new Set()
  let streamingMode = false
  let currentToolName = ''
  let currentToolInput = ''

  function write(text) {
    output.write(text)
  }

  function writeError(text) {
    errorOutput.write(text)
  }

  function processLine(line) {
    try {
      const data = JSON.parse(line)

      if (process.env.DEBUG) {
        writeError(
          `[DEBUG] type=${data.type} event=${data.event?.type || '-'}\n`
        )
      }

      // Handle stream_event (real-time streaming with --include-partial-messages)
      if (data.type === 'stream_event') {
        streamingMode = true
        const event = data.event

        // Tool use starts
        if (
          event.type === 'content_block_start' &&
          event.content_block?.type === 'tool_use'
        ) {
          if (inTextBlock) {
            write('\n\n')
            inTextBlock = false
          }
          currentToolName = event.content_block.name
          currentToolInput = ''
        }

        // Text block starts
        if (
          event.type === 'content_block_start' &&
          event.content_block?.type === 'text'
        ) {
          inTextBlock = true
        }

        // Text delta - write immediately for streaming
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          write(event.delta.text)
        }

        // Tool input delta - accumulate the JSON
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'input_json_delta'
        ) {
          currentToolInput += event.delta.partial_json
        }

        // Block ends - show tool details
        if (event.type === 'content_block_stop') {
          if (currentToolName) {
            const details = formatToolDetails(currentToolName, currentToolInput)
            write(`\n🔧 ${currentToolName}${details}\n`)
            currentToolName = ''
            currentToolInput = ''
          }
          inTextBlock = false
        }

        // Message ends
        if (event.type === 'message_stop') {
          write('\n')
          streamingMode = false
        }
      }

      // Handle assistant messages ONLY if not in streaming mode (avoid duplicates)
      if (
        data.type === 'assistant' &&
        data.message?.content &&
        !streamingMode
      ) {
        for (const block of data.message.content) {
          if (block.type === 'text') {
            write(block.text)
            write('\n')
          } else if (
            block.type === 'tool_use' &&
            block.id &&
            !seenToolIds.has(block.id)
          ) {
            seenToolIds.add(block.id)
            write(`\n🔧 ${block.name}\n`)
          }
        }
      }

      // Tool results
      if (data.type === 'tool_result') {
        write('✓ Done\n\n')
      }

      // User messages (from tool results)
      if (data.type === 'user') {
        // Could display tool output here if needed
      }

      // Errors
      if (data.type === 'error') {
        writeError(
          `❌ Error: ${data.error?.message || JSON.stringify(data.error)}\n`
        )
      }
    } catch (_e) {
      if (process.env.DEBUG && line.trim()) {
        writeError(`[DEBUG] Parse fail: ${line.slice(0, 100)}\n`)
      }
    }
  }

  return { processLine }
}

// Run as CLI when executed directly
if (require.main === module) {
  const parser = createParser()
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })
  rl.on('line', parser.processLine)
}

// Export for testing
module.exports = { formatToolDetails, createParser }
