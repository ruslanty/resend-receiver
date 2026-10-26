import PostalMime from "postal-mime";

export class PostalMimeParser {
  async parse(rawContent) {
    const parsed = await PostalMime.parse(rawContent);
    return {
      text: parsed.text,
      html: parsed.html,
      attachments: (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename,
        content: new Uint8Array(attachment.content),
        mediaType: attachment.mimeType,
        contentId: attachment.contentId?.replace(/^<|>$/g, "") || undefined,
      })),
    };
  }
}
