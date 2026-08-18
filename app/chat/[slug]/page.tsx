import ChatLinkEntry from "@/components/chat/chat-link-entry";

export default async function PublicChatLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ChatLinkEntry slug={slug} />;
}
