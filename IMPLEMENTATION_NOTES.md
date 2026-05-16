# Building Model Extraction - Implementation Notes

## Environment Configuration

The chat endpoint requires `ANTHROPIC_API_KEY` environment variable to be configured in the deployed environment.

### For Vercel Deployment:
1. Go to Vercel project settings
2. Add Environment Variable: `ANTHROPIC_API_KEY`
3. Add your Anthropic API key
4. Redeploy the application

### For Local Development:
Create `.env.local` file:
```
ANTHROPIC_API_KEY=your_api_key_here
```

## Implementation Details

### Tool Call Extraction
The building model is extracted from chat messages by processing `set_building` tool calls. The model state accumulates across all messages in the conversation, allowing partial updates.

### Runtime
The chat endpoint uses Node.js runtime (not edge) for better environment variable support and compatibility with the AI SDK.

### Error Handling
The endpoint returns a clear error message if the `ANTHROPIC_API_KEY` is not configured.