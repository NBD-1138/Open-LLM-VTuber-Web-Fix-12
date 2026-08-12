import { ChangeEvent, useRef, useState } from 'react';
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';

type UploadedImageData = {
  source: 'upload';
  data: string;
  mime_type: string;
};

type UploadedFileData = {
  name: string;
  data: string;
  mime_type: string;
};

type PendingAttachment = {
  name: string;
  mimeType: string;
  kind: 'image' | 'file';
  payload: string;
};

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

const readFileAsDataUrl = (file: File): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  })
);

const summarizeAttachmentNames = (attachments: PendingAttachment[]) => {
  if (attachments.length === 0) {
    return '';
  }

  const previewNames = attachments.slice(0, 3).map((attachment) => attachment.name).join(', ');
  if (attachments.length <= 3) {
    return previewNames;
  }

  return `${previewNames}, +${attachments.length - 3} more`;
};

const buildOutgoingMessagePreview = (text: string, attachments: PendingAttachment[]) => {
  if (attachments.length === 0) {
    return text;
  }

  const attachmentSummary = `[Attached: ${summarizeAttachmentNames(attachments)}]`;
  return text ? `${text}\n${attachmentSummary}` : attachmentSummary;
};

export function useTextInput() {
  const [inputText, setInputText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleAttachmentButtonClick = () => {
    attachmentInputRef.current?.click();
  };

  const handleAttachmentSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (selectedFiles.length === 0) {
      return;
    }

    const skippedFiles: string[] = [];
    const nextAttachments: PendingAttachment[] = [];

    for (const file of selectedFiles) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        skippedFiles.push(`${file.name} (over 5 MB)`);
        continue;
      }

      let dataUrl = '';
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch (error) {
        console.error('Failed to read attachment:', file.name, error);
        skippedFiles.push(file.name);
        continue;
      }

      const kind = file.type.startsWith('image/') ? 'image' : 'file';
      nextAttachments.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        kind,
        payload: kind === 'image' ? dataUrl : dataUrl.split(',', 2)[1] ?? '',
      });
    }

    if (nextAttachments.length > 0) {
      setAttachments(nextAttachments);
      toaster.create({
        title: `Attached ${nextAttachments.length} file${nextAttachments.length === 1 ? '' : 's'}`,
        description: summarizeAttachmentNames(nextAttachments),
        type: 'success',
        duration: 2500,
      });
    }

    if (skippedFiles.length > 0) {
      toaster.create({
        title: 'Some files were skipped',
        description: skippedFiles.join(', '),
        type: 'warning',
        duration: 3000,
      });
    }
  };

  const handleSend = async () => {
    if ((!inputText.trim() && attachments.length === 0) || !wsContext) return;
    if (aiState === 'thinking-speaking') {
      interrupt();
    }

    const capturedImages = await captureAllMedia();
    const uploadedImages: UploadedImageData[] = attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        source: 'upload',
        data: attachment.payload,
        mime_type: attachment.mimeType,
      }));
    const uploadedFiles: UploadedFileData[] = attachments
      .filter((attachment) => attachment.kind === 'file')
      .map((attachment) => ({
        name: attachment.name,
        data: attachment.payload,
        mime_type: attachment.mimeType,
      }));
    const trimmedText = inputText.trim();
    const images = [...capturedImages, ...uploadedImages];

    appendHumanMessage(buildOutgoingMessagePreview(trimmedText, attachments));
    wsContext.sendMessage({
      type: 'text-input',
      text: trimmedText,
      images: images.length > 0 ? images : undefined,
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    });

    if (autoStopMic) stopMic();
    setInputText('');
    setAttachments([]);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => setIsComposing(true);
  const handleCompositionEnd = () => setIsComposing(false);

  return {
    inputText,
    setInputText: handleInputChange,
    handleSend,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    attachmentInputRef,
    attachments,
    handleAttachmentButtonClick,
    handleAttachmentSelection,
  };
}
