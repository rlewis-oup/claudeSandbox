import React from 'react';
import { Upload, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FileUploadProps {
  onFilesSelected: (files: { data: string | any; type: string; name: string }[]) => void;
  mode: 'visual' | 'excel';
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, mode }) => {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    const files = Array.from(e.target.files);
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

  const isExcel = mode === 'excel';

  return (
    <div className="w-full">
      <label 
        id="file-upload-label"
        className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-zinc-300 rounded-2xl cursor-pointer bg-zinc-50 hover:bg-zinc-100 transition-colors"
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          {isExcel ? (
            <FileSpreadsheet className="w-10 h-10 mb-3 text-emerald-500" />
          ) : (
            <Upload className="w-10 h-10 mb-3 text-zinc-400" />
          )}
          <p className="mb-2 text-sm text-zinc-500">
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-zinc-400">
            {isExcel ? 'Excel (.xlsx, .xls)' : 'PDF or Images (PNG, JPG)'}
          </p>
        </div>
        <input 
          id="file-upload-input"
          type="file" 
          className="hidden" 
          multiple={!isExcel} 
          accept={isExcel ? '.xlsx, .xls' : 'image/*,application/pdf'}
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
};
