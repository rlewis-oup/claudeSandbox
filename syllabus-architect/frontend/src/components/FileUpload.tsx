import React, { useId, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, BookOpen, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FileUploadProps {
  onFilesSelected: (files: { data: string | any; type: string; name: string }[]) => void;
  mode: 'visual' | 'excel' | 'fullpdf';
  maxFiles?: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, mode, maxFiles }) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = async (fileList: File[]) => {
    let files = fileList;
    if (maxFiles && files.length > maxFiles) {
      files = files.slice(0, maxFiles);
    }

    const processedFiles = await Promise.all(
      files.map(async (file) => {
        return new Promise<{ data: string | any; type: string; name: string }>((resolve) => {
          const reader = new FileReader();

          if (mode === 'excel') {
            reader.onload = (e) => {
              const data = new Uint8Array(e.target?.result as ArrayBuffer);
              const workbook = XLSX.read(data, { type: 'array' });
              const sheetData: Record<string, any[]> = {};

              workbook.SheetNames.forEach(sheetName => {
                sheetData[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
              });

              resolve({
                data: sheetData,
                type: file.type,
                name: file.name
              });
            };
            reader.readAsArrayBuffer(file);
          } else if (mode === 'fullpdf') {
            resolve({
              data: file,
              type: file.type,
              name: file.name
            });
          } else {
            reader.onloadend = () => {
              resolve({
                data: reader.result as string,
                type: file.type,
                name: file.name
              });
            };
            reader.readAsDataURL(file);
          }
        });
      })
    );

    onFilesSelected(processedFiles);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await processFiles(Array.from(e.target.files));
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    await processFiles(droppedFiles);
  };

  const isExcel = mode === 'excel';
  const isFullPdf = mode === 'fullpdf';

  const acceptTypes = isExcel ? '.xlsx,.xls' : isFullPdf ? '.pdf' : '.pdf,.png,.jpg,.jpeg,image/*';
  const allowMultiple = !isExcel;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-zinc-300 bg-zinc-50 hover:bg-zinc-100'
        }`}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          {isExcel ? (
            <FileSpreadsheet className="w-10 h-10 mb-3 text-emerald-500" />
          ) : isFullPdf ? (
            <BookOpen className="w-10 h-10 mb-3 text-indigo-500" />
          ) : (
            <Upload className="w-10 h-10 mb-3 text-zinc-400" />
          )}
          <p className="mb-2 text-sm text-zinc-500">
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-zinc-400">
            {isExcel ? 'Excel (.xlsx, .xls)' : isFullPdf ? `PDF files only (max ${maxFiles || 4})` : 'PDF or Images (PNG, JPG)'}
          </p>
        </div>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={allowMultiple}
          accept={acceptTypes}
          onChange={handleFileChange}
        />
      </label>
      {isExcel && (
        <div className="mt-3 flex justify-center">
          <a
            href="/benchmark-or-syllabus-file-example.xlsx"
            download="benchmark or syllabus file example.xlsx"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download example Excel file for use
          </a>
        </div>
      )}
    </div>
  );
};
