import React, { useState, useRef, useCallback } from 'react';
import {
  Download,
  Upload,
  FileJson,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  FileUp,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { cn } from '../ui/cn';

/**
 * AdminConfigExport - Import/Export configuration management component
 *
 * Provides functionality to:
 * - Export current configuration as JSON
 * - Import configuration from JSON file with preview
 * - Confirmation dialog before applying imported settings
 * - Success/error feedback display
 */
export function AdminConfigExport({ onExport, onImport, exporting = false, importing = false }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const fileInputRef = useRef(null);

  // Clear feedback after a timeout
  const showFeedback = useCallback((type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 5000);
  }, []);

  // Handle export button click
  const handleExport = useCallback(async () => {
    try {
      await onExport();
      showFeedback('success', 'Configuration exported successfully');
    } catch (error) {
      showFeedback('error', error.message || 'Failed to export configuration');
    }
  }, [onExport, showFeedback]);

  // Handle file selection
  const handleFileSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset previous state
    setParseError(null);
    setPreviewData(null);
    setFeedback(null);

    // Validate file type
    if (!file.name.endsWith('.json')) {
      setParseError('Please select a JSON file');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);

    // Read and parse the file
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = JSON.parse(e.target.result);

        // Basic validation of the config structure
        if (!content || typeof content !== 'object') {
          setParseError('Invalid configuration format: expected an object');
          setPreviewData(null);
          return;
        }

        // Extract preview information
        const configKeys = Object.keys(content);
        const preview = {
          filename: file.name,
          fileSize: file.size,
          configCount: configKeys.length,
          categories: extractCategories(content),
          rawData: content,
        };

        setPreviewData(preview);
        setParseError(null);
      } catch (err) {
        setParseError(`Failed to parse JSON: ${err.message}`);
        setPreviewData(null);
      }
    };
    reader.onerror = () => {
      setParseError('Failed to read file');
      setPreviewData(null);
    };
    reader.readAsText(file);
  }, []);

  // Extract category information from config
  const extractCategories = (config) => {
    const categories = {};
    for (const key of Object.keys(config)) {
      // Assume keys are in format "category.setting" or just grouped by prefix
      const category = key.includes('.') ? key.split('.')[0] : 'general';
      categories[category] = (categories[category] || 0) + 1;
    }
    return categories;
  };

  // Clear selected file
  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setPreviewData(null);
    setParseError(null);
    setFeedback(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Open confirmation dialog
  const handleImportClick = useCallback(() => {
    if (!previewData) return;
    setShowConfirmDialog(true);
  }, [previewData]);

  // Confirm and apply import
  const handleConfirmImport = useCallback(async () => {
    if (!previewData) return;

    setShowConfirmDialog(false);

    try {
      await onImport(previewData.rawData);
      showFeedback(
        'success',
        `Successfully imported ${previewData.configCount} configuration settings`
      );
      handleClearFile();
    } catch (error) {
      showFeedback('error', error.message || 'Failed to import configuration');
    }
  }, [previewData, onImport, showFeedback, handleClearFile]);

  // Format file size for display
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="config-export space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={cn(
            'flex items-center gap-3 p-4 rounded-lg border',
            feedback.type === 'success' &&
              'bg-accent-green/10 border-accent-green/30 text-accent-green',
            feedback.type === 'error' && 'bg-accent-red/10 border-accent-red/30 text-accent-red'
          )}
          role="alert"
          aria-live="polite"
        >
          {feedback.type === 'success' ? (
            <CheckCircle size={20} aria-hidden="true" />
          ) : (
            <XCircle size={20} aria-hidden="true" />
          )}
          <span className="font-medium">{feedback.message}</span>
        </div>
      )}

      {/* Export Section */}
      <section className="rounded-lg bg-bg-card border border-border p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-accent-cyan/10">
            <Download size={24} className="text-accent-cyan" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-primary mb-1">Export Configuration</h3>
            <p className="text-text-secondary text-sm mb-4">
              Download your current system configuration as a JSON file. This can be used for backup
              or to transfer settings to another instance.
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-md',
                'bg-accent-cyan text-white font-medium text-sm',
                'hover:bg-accent-cyan/90 transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              aria-busy={exporting}
              aria-label={exporting ? 'Exporting configuration' : 'Export configuration as JSON'}
            >
              {exporting ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download size={16} aria-hidden="true" />
                  Export as JSON
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Import Section */}
      <section className="rounded-lg bg-bg-card border border-border p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-accent-purple/10">
            <Upload size={24} className="text-accent-purple" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-primary mb-1">Import Configuration</h3>
            <p className="text-text-secondary text-sm mb-4">
              Upload a JSON configuration file to apply settings. You will be able to preview the
              changes before applying them.
            </p>

            {/* File Upload Area */}
            <div
              className={cn(
                'relative border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                'hover:border-accent-purple/50 hover:bg-accent-purple/5',
                parseError ? 'border-accent-red/50 bg-accent-red/5' : 'border-border',
                previewData && 'border-accent-green/50 bg-accent-green/5'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Select JSON configuration file to import"
              />

              {!selectedFile ? (
                <div className="space-y-2">
                  <FileUp size={32} className="mx-auto text-text-muted" aria-hidden="true" />
                  <p className="text-text-secondary text-sm">
                    <span className="text-accent-purple font-medium">Click to upload</span> or drag
                    and drop
                  </p>
                  <p className="text-text-muted text-xs">JSON files only</p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3">
                  <FileJson size={24} className="text-accent-purple" aria-hidden="true" />
                  <div className="text-left">
                    <p className="text-text-primary font-medium text-sm">{selectedFile.name}</p>
                    <p className="text-text-muted text-xs">{formatFileSize(selectedFile.size)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Parse Error */}
            {parseError && (
              <div className="mt-3 flex items-center gap-2 text-accent-red text-sm" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Preview Section */}
            {previewData && !parseError && (
              <div className="mt-4 p-4 rounded-lg bg-bg-dark border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle size={16} className="text-accent-green" aria-hidden="true" />
                  <span className="font-medium text-text-primary text-sm">File validated</span>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Total settings:</span>
                    <span className="text-text-primary font-medium">{previewData.configCount}</span>
                  </div>

                  {Object.keys(previewData.categories).length > 0 && (
                    <div>
                      <span className="text-text-secondary">Categories:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {Object.entries(previewData.categories).map(([category, count]) => (
                          <span
                            key={category}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-bg-card border border-border"
                          >
                            <span className="text-text-secondary">{category}:</span>
                            <span className="text-text-primary font-medium">{count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={handleImportClick}
                    disabled={importing}
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-md',
                      'bg-accent-purple text-white font-medium text-sm',
                      'hover:bg-accent-purple/90 transition-colors duration-200',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                    aria-busy={importing}
                    aria-label={
                      importing ? 'Importing configuration' : 'Apply imported configuration'
                    }
                  >
                    {importing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload size={16} aria-hidden="true" />
                        Apply Configuration
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleClearFile}
                    disabled={importing}
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-md',
                      'bg-transparent text-text-secondary font-medium text-sm',
                      'border border-border',
                      'hover:bg-white/5 hover:text-text-primary transition-colors duration-200',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                    aria-label="Clear selected file"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent variant="warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-accent-yellow" aria-hidden="true" />
              Confirm Import
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to import{' '}
              <span className="font-semibold text-text-primary">
                {previewData?.configCount || 0} configuration settings
              </span>{' '}
              from <span className="font-semibold text-text-primary">{previewData?.filename}</span>.
              <br />
              <br />
              This will overwrite existing settings with matching keys. This action cannot be undone
              unless you have a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              disabled={importing}
              className={cn('bg-accent-yellow text-bg-dark', 'hover:bg-accent-yellow/90')}
            >
              {importing ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" aria-hidden="true" />
                  Importing...
                </>
              ) : (
                'Import Configuration'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AdminConfigExport;
