import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Plus,
  Trash2,
  BarChart3,
  Loader2,
  ChevronRight,
  CheckCircle2,
  BookMarked,
  Layers,
  FileSpreadsheet,
  Image as ImageIcon,
  Download,
  FileText,
  FileCode,
  ArrowRight,
  Upload
} from 'lucide-react';
import Markdown from 'react-markdown';
import { saveAs } from 'file-saver';
import { Packer } from 'docx';
import { buildDocxFromMarkdown } from './utils/markdownToDocx';
import * as XLSX from 'xlsx';
import { FileUpload } from './components/FileUpload';
import { analyzeCoursebookImage, analyzeCoursebookExcel, analyzeFullPdf, compareCoursebooks, compareWithBenchmark } from './services/claudeService';
import { captureTokenFromHash, isAuthenticated, login, logout } from './auth';
import { Coursebook } from './types';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [coursebooks, setCoursebooks] = useState<Coursebook[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'comparison'>('upload');
  const [uploadMode, setUploadMode] = useState<'visual' | 'excel' | 'fullpdf'>('visual');
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [comparisonType, setComparisonType] = useState<'peer' | 'benchmark'>('peer');
  const [benchmarkSyllabus, setBenchmarkSyllabus] = useState<Coursebook | null>(null);
  const [postAnalysisChoice, setPostAnalysisChoice] = useState<'none' | 'download' | 'benchmark'>('none');
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    captureTokenFromHash();
    if (isAuthenticated()) {
      setAuthed(true);
    } else {
      login();
    }
  }, []);

  const handleBenchmarkFile = async (files: { data: string | any; type: string; name: string }[]) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      if (files.length > 0) {
        const file = files[0];
        const parsedBooks = await analyzeCoursebookExcel(file.data);
        if (parsedBooks && parsedBooks.length > 0) {
          const cleanTitle = file.name ? file.name.replace(/\.[^/.]+$/, "") : "Benchmark Standard";
          const firstBook = parsedBooks[0];
          setBenchmarkSyllabus({
            ...firstBook,
            title: firstBook.title || cleanTitle
          });
        } else {
          setErrorMessage("No syllabus data could be extracted from the benchmark file.");
        }
      }
    } catch (error: any) {
      console.error("Failed to parse benchmark syllabus:", error);
      setErrorMessage(error?.message || "Failed to parse benchmark syllabus. Please check the file format.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFilesSelected = async (files: { data: string | any; type: string; name: string }[]) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      if (uploadMode === 'excel') {
        for (const file of files) {
          const newBooks = await analyzeCoursebookExcel(file.data);
          setCoursebooks(prev => [...prev, ...newBooks]);
        }
      } else if (uploadMode === 'fullpdf') {
        for (const file of files) {
          const book = await analyzeFullPdf(file.data, file.name);
          setCoursebooks(prev => [...prev, book]);
        }
      } else {
        const newBooks = await Promise.all(
          files.map(file => analyzeCoursebookImage(file.data as string, file.type, file.name))
        );
        setCoursebooks(prev => [...prev, ...newBooks]);
      }
    } catch (error: any) {
      console.error("Analysis failed:", error);
      setErrorMessage(error?.message || "Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCompare = async () => {
    if (comparisonType === 'benchmark') {
      if (!benchmarkSyllabus || coursebooks.length < 1) return;
      setIsAnalyzing(true);
      try {
        const result = await compareWithBenchmark(benchmarkSyllabus, coursebooks);
        setComparisonResult(result);
        setActiveTab('comparison');
      } catch (error) {
        console.error("Benchmark audit comparison failed:", error);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      if (coursebooks.length < 2) return;
      setIsAnalyzing(true);
      try {
        const result = await compareCoursebooks(coursebooks);
        setComparisonResult(result);
        setActiveTab('comparison');
      } catch (error) {
        console.error("Comparison failed:", error);
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  const exportToTxt = () => {
    if (!comparisonResult) return;
    const blob = new Blob([comparisonResult], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, 'syllabus-analysis.txt');
    setShowExportOptions(false);
  };

  const exportToDocx = async () => {
    if (!comparisonResult) return;
    const doc = buildDocxFromMarkdown(comparisonResult);
    const blob = await Packer.toBlob(doc);
    saveAs(blob, 'syllabus-analysis.docx');
    setShowExportOptions(false);
  };

  const sortUnits = (units: typeof coursebooks[0]['units']) => {
    return [...units].sort((a, b) => {
      const aStr = String(a.unitNumber).trim().toLowerCase();
      const bStr = String(b.unitNumber).trim().toLowerCase();

      const isStarter = (s: string) => s === 'starter';
      const isLetter = (s: string) => /^[a-z]$/i.test(s);
      const isNumber = (s: string) => /^\d+$/.test(s);

      if (isStarter(aStr) && !isStarter(bStr)) return -1;
      if (!isStarter(aStr) && isStarter(bStr)) return 1;

      if (isLetter(aStr) && !isLetter(bStr) && !isStarter(bStr)) return -1;
      if (!isLetter(aStr) && !isStarter(aStr) && isLetter(bStr)) return 1;
      if (isLetter(aStr) && isLetter(bStr)) return aStr.localeCompare(bStr);

      if (isNumber(aStr) && isNumber(bStr)) return parseInt(aStr) - parseInt(bStr);
      if (isNumber(aStr) && !isNumber(bStr) && !isLetter(bStr) && !isStarter(bStr)) return -1;
      if (!isNumber(aStr) && !isLetter(aStr) && !isStarter(aStr) && isNumber(bStr)) return 1;

      return aStr.localeCompare(bStr);
    });
  };

  const exportToExcel = () => {
    if (coursebooks.length === 0) return;

    const data = coursebooks.map(book => {
      const row: any = { 'Course Name': book.title };
      const sorted = sortUnits(book.units);
      sorted.forEach((unit) => {
        const grammarPoints = unit.grammar.map(g => g.item).join(', ');
        row[`Unit ${unit.unitNumber} Grammar`] = grammarPoints;
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Syllabus Comparison");

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, 'syllabus-comparison.xlsx');
    setShowExportOptions(false);
  };

  const removeCoursebook = (id: string) => {
    setCoursebooks(prev => prev.filter(b => b.id !== id));
  };

  const handlePostAnalysisBenchmark = async (files: { data: string | any; type: string; name: string }[]) => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    try {
      const file = files[0];
      const parsedBooks = await analyzeCoursebookExcel(file.data);
      if (parsedBooks && parsedBooks.length > 0) {
        const cleanTitle = file.name ? file.name.replace(/\.[^/.]+$/, "") : "Benchmark Standard";
        const benchmark = { ...parsedBooks[0], title: parsedBooks[0].title || cleanTitle };
        const result = await compareWithBenchmark(benchmark, coursebooks);
        setBenchmarkResult(result);
      }
    } catch (error) {
      console.error("Post-analysis benchmark comparison failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportToRtf = () => {
    if (!comparisonResult) return;
    const rtfContent = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Calibri;}}\\f0\\fs22 ${comparisonResult.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\par ')}}`;
    const blob = new Blob([rtfContent], { type: 'application/rtf' });
    saveAs(blob, 'syllabus-analysis.rtf');
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] text-zinc-900 font-sans flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <div className="w-12 h-12 bg-zinc-900 rounded-lg flex items-center justify-center mx-auto">
            <BookMarked className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign-in required</h1>
          <p className="text-zinc-500">
            You need to be signed in to use Syllabus Architect. Please launch this app from the
            ELT Editorial Utils portal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-zinc-900 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
              <BookMarked className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Syllabus Architect</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <nav className="flex gap-1 bg-zinc-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'upload' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                Coursebooks
              </button>
              <button
                onClick={() => setActiveTab('comparison')}
                disabled={!comparisonResult}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'comparison' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 disabled:opacity-50'}`}
              >
                Analysis
              </button>
            </nav>
            <button
              onClick={logout}
              className="text-sm text-zinc-500 hover:text-zinc-900 font-medium transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {activeTab === 'upload' ? (
            <motion.div 
              key="upload-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              {/* Hero Section */}
              <div className="max-w-2xl">
                <h2 className="text-4xl font-light tracking-tight mb-4">
                  Build the perfect <span className="italic font-serif">syllabus</span>.
                </h2>
                <p className="text-zinc-500 text-lg">
                  Upload content pages from multiple English coursebooks. We'll extract the grammar to help you design a superior curriculum.
                </p>
              </div>

              {/* Comparative Objective */}
              <div className="bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-medium">Select Comparative Objective</h3>
                  <p className="text-zinc-500 text-sm">Choose how you want to evaluate and compare grammar syllabi.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button 
                    onClick={() => {
                      setComparisonType('peer');
                      setComparisonResult(null);
                    }}
                    className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${comparisonType === 'peer' ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
                  >
                    <div className={`p-3 rounded-lg ${comparisonType === 'peer' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      <BarChart3 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-zinc-900">Peer-to-Peer Cohort comparison</h4>
                      <p className="text-sm text-zinc-500">Cross-reference multiple coursebooks directly to evaluate general overlap, gaps, and unique coverages.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setComparisonType('benchmark');
                      setComparisonResult(null);
                      setUploadMode('excel');
                    }}
                    className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${comparisonType === 'benchmark' ? 'border-amber-600 bg-amber-50/30' : 'border-zinc-100 hover:border-zinc-200'}`}
                  >
                    <div className={`p-3 rounded-lg ${comparisonType === 'benchmark' ? 'bg-amber-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      <BookMarked className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-zinc-900">Benchmark Alignment Audit</h4>
                      <p className="text-sm text-zinc-500">Establish a master syllabus (via Excel) as the target standard, then audit third-party syllabi against it.</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Mode Selection — hidden when benchmark is selected (benchmark always uses Excel) */}
              {comparisonType !== 'benchmark' && (
              <div className="bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-medium">How do you want to add target coursebooks?</h3>
                  <p className="text-zinc-500 text-sm">Choose your preferred input method for coursebooks under analysis.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => setUploadMode('visual')}
                    className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${uploadMode === 'visual' ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-100 hover:border-zinc-200'}`}
                  >
                    <div className={`p-3 rounded-lg ${uploadMode === 'visual' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Visual Analysis</h4>
                      <p className="text-sm text-zinc-500">Upload photos or PDFs of content pages. Best for physical books.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setUploadMode('excel')}
                    className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${uploadMode === 'excel' ? 'border-emerald-600 bg-emerald-50' : 'border-zinc-100 hover:border-zinc-200'}`}
                  >
                    <div className={`p-3 rounded-lg ${uploadMode === 'excel' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Excel Import</h4>
                      <p className="text-sm text-zinc-500">Upload an Excel file containing multiple syllabi. Best for digital records.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setUploadMode('fullpdf')}
                    className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${uploadMode === 'fullpdf' ? 'border-indigo-600 bg-indigo-50' : 'border-zinc-100 hover:border-zinc-200'}`}
                  >
                    <div className={`p-3 rounded-lg ${uploadMode === 'fullpdf' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                      <BookOpen className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Full Coursebook PDF</h4>
                      <p className="text-sm text-zinc-500">Upload complete coursebook PDFs (max 4). AI maps the full grammar syllabus.</p>
                    </div>
                  </button>
                </div>
              </div>
              )}

              {/* Upload Area */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-6">
                  {/* Master Benchmark Upload Block */}
                  {comparisonType === 'benchmark' && (
                    <div className="bg-white p-6 rounded-2xl border border-amber-200 shadow-sm space-y-4">
                      <h3 className="font-medium flex items-center gap-2 text-amber-900">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold">1</span>
                        <BookMarked className="w-4 h-4 text-amber-600" /> Upload Master Benchmark Syllabus
                      </h3>

                      {benchmarkSyllabus ? (
                        <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100 flex items-start justify-between">
                          <div className="space-y-1">
                            <h4 className="font-semibold text-amber-950 text-sm truncate max-w-[180px]">{benchmarkSyllabus.title}</h4>
                            <span className="text-xs text-amber-800 block">
                              {benchmarkSyllabus.units?.length || 0} Units Loaded • Master Standard
                            </span>
                          </div>
                          <button
                            onClick={() => setBenchmarkSyllabus(null)}
                            className="text-xs text-amber-700 hover:text-amber-900 font-medium underline"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-zinc-500">
                            Upload your curriculum standard as an Excel file (.xlsx, .xls) to serve as the master syllabus.
                          </p>
                          <FileUpload onFilesSelected={handleBenchmarkFile} mode="excel" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
                    <h3 className="font-medium mb-4 flex items-center gap-2">
                      {comparisonType === 'benchmark' && (
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold">2</span>
                      )}
                      <Plus className="w-4 h-4" />
                      {comparisonType === 'benchmark'
                        ? 'Upload Coursebooks to Audit'
                        : uploadMode === 'excel' ? 'Add Excel File' : uploadMode === 'fullpdf' ? 'Add Full Coursebook PDF' : 'Add Coursebook'}
                    </h3>
                    {comparisonType === 'benchmark' && (
                      <p className="text-xs text-zinc-500 mb-3">
                        Upload one or more Excel files containing the syllabi you want to audit against the benchmark.
                      </p>
                    )}
                    {uploadMode === 'fullpdf' && comparisonType !== 'benchmark' && (
                      <p className="text-xs text-zinc-500 mb-3">
                        Upload up to 4 complete coursebook PDFs. The AI will analyse the entire book and map all units, lessons, and grammar points.
                      </p>
                    )}
                    <FileUpload onFilesSelected={handleFilesSelected} mode={comparisonType === 'benchmark' ? 'excel' : uploadMode} maxFiles={uploadMode === 'fullpdf' ? 4 : undefined} />
                  </div>

                  {/* Operational trigger buttons */}
                  {((comparisonType === 'peer' && coursebooks.length >= 2) || 
                    (comparisonType === 'benchmark' && benchmarkSyllabus !== null && coursebooks.length >= 1)) && (
                    <button 
                      onClick={handleCompare}
                      disabled={isAnalyzing}
                      className={`w-full text-white py-4 rounded-2xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${comparisonType === 'benchmark' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-zinc-900 hover:bg-zinc-800'}`}
                    >
                      {isAnalyzing ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <BarChart3 className="w-5 h-5" />
                          {comparisonType === 'benchmark' ? 'Generate Benchmark Audit' : 'Generate Comparison'}
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="lg:col-span-2">
                  <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                      <h3 className="font-medium flex items-center gap-2">
                        <Layers className="w-4 h-4" /> Analyzed Books
                        <span className="ml-2 px-2 py-0.5 bg-zinc-100 text-zinc-500 text-xs rounded-full">
                          {coursebooks.length}
                        </span>
                      </h3>
                    </div>

                    {errorMessage && (
                      <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                        <strong>Error:</strong> {errorMessage}
                        <button onClick={() => setErrorMessage(null)} className="ml-3 underline text-red-600 hover:text-red-800">Dismiss</button>
                      </div>
                    )}

                    <div className="divide-y divide-zinc-100">
                      {coursebooks.length === 0 ? (
                        <div className="p-12 text-center text-zinc-400 italic">
                          No coursebooks analyzed yet. Upload data to get started.
                        </div>
                      ) : (
                        coursebooks.map((book) => {
                          const totalGrammar = book.units.reduce((sum, u) => sum + u.grammar.length, 0);
                          const totalLexical = book.units.reduce((sum, u) => sum + (u.lexicalItemCount || 0), 0);
                          const totalActivities = book.units.reduce((sum, u) => sum + (u.activityCounts?.total || 0), 0);
                          const hasLessons = book.units.some((u: any) => u.lessons && u.lessons.length > 0);
                          const hasRichData = book.units.some(u => u.activityCounts || u.theme || u.additionalFeatures?.length);
                          const allFeatures = [...new Set(book.units.flatMap(u => u.additionalFeatures || []))];
                          return (
                            <div key={book.id} className="p-6 flex items-start justify-between hover:bg-zinc-50 transition-colors group">
                              <div className="space-y-2 flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium text-zinc-900">{book.title}</h4>
                                  {book.level && <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs rounded-full">{book.level}</span>}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                                  <span className="flex items-center gap-1">
                                    <BookOpen className="w-3 h-3" /> {book.units.length} Units
                                  </span>
                                  {hasLessons && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> Lesson-level</span>}
                                  {totalGrammar > 0 && <span>{totalGrammar} grammar pts</span>}
                                  {totalLexical > 0 && <span>{totalLexical} lexical items</span>}
                                  {totalActivities > 0 && <span>{totalActivities} activities</span>}
                                  {book.publisher && <span>{book.publisher}</span>}
                                </div>
                                {hasRichData && allFeatures.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {allFeatures.slice(0, 8).map(f => (
                                      <span key={f} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] rounded-full">{f}</span>
                                    ))}
                                    {allFeatures.length > 8 && (
                                      <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 text-[10px] rounded-full">+{allFeatures.length - 8} more</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => removeCoursebook(book.id)}
                                className="p-2 text-zinc-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="comparison-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-light tracking-tight">Syllabus Analysis</h2>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <button 
                      onClick={() => setShowExportOptions(!showExportOptions)}
                      className="bg-white border border-zinc-200 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-zinc-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export Analysis
                    </button>
                    
                    <AnimatePresence>
                      {showExportOptions && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute right-0 mt-2 w-48 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 overflow-hidden"
                        >
                          <button 
                            onClick={exportToDocx}
                            className="w-full px-4 py-3 text-left text-sm hover:bg-zinc-50 flex items-center gap-2 border-b border-zinc-100"
                          >
                            <FileText className="w-4 h-4 text-blue-600" />
                            Microsoft Word (.docx)
                          </button>
                          <button 
                            onClick={exportToTxt}
                            className="w-full px-4 py-3 text-left text-sm hover:bg-zinc-50 flex items-center gap-2"
                          >
                            <FileCode className="w-4 h-4 text-zinc-500" />
                            Plain Text (.txt)
                          </button>
                          <button 
                            onClick={exportToExcel}
                            className="w-full px-4 py-3 text-left text-sm hover:bg-zinc-50 flex items-center gap-2 border-t border-zinc-100"
                          >
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                            Excel Spreadsheet (.xlsx)
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button 
                    onClick={() => setActiveTab('upload')}
                    className="text-sm text-zinc-500 hover:text-zinc-900 flex items-center gap-1"
                  >
                    Back to Uploads
                  </button>
                </div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm prose prose-zinc max-w-none">
                <div className="markdown-body">
                  <Markdown>{comparisonResult || ''}</Markdown>
                </div>
              </div>

              {/* What would you like to do now? */}
              {comparisonResult && comparisonType === 'peer' && !benchmarkResult && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm space-y-6"
                >
                  <div className="space-y-2">
                    <h3 className="text-xl font-medium">What would you like to do now?</h3>
                    <p className="text-zinc-500 text-sm">Choose your next step based on the analysis above.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => setPostAnalysisChoice('download')}
                      className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${postAnalysisChoice === 'download' ? 'border-blue-600 bg-blue-50/30' : 'border-zinc-100 hover:border-zinc-200'}`}
                    >
                      <div className={`p-3 rounded-lg ${postAnalysisChoice === 'download' ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                        <Download className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-zinc-900">Download Analysis</h4>
                        <p className="text-sm text-zinc-500">Export the comparative analysis as a .docx or .rtf document.</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setPostAnalysisChoice('benchmark')}
                      className={`flex items-start gap-4 p-6 rounded-xl border-2 transition-all text-left ${postAnalysisChoice === 'benchmark' ? 'border-amber-600 bg-amber-50/30' : 'border-zinc-100 hover:border-zinc-200'}`}
                    >
                      <div className={`p-3 rounded-lg ${postAnalysisChoice === 'benchmark' ? 'bg-amber-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                        <BookMarked className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-zinc-900">Compare Against Benchmark</h4>
                        <p className="text-sm text-zinc-500">Upload a benchmark syllabus (Excel) and audit your coursebooks against it.</p>
                      </div>
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {postAnalysisChoice === 'download' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-3 pt-4 border-t border-zinc-100"
                      >
                        <button
                          onClick={exportToDocx}
                          className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                          Download .docx
                        </button>
                        <button
                          onClick={exportToRtf}
                          className="flex items-center gap-2 px-5 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-900 transition-colors"
                        >
                          <FileCode className="w-4 h-4" />
                          Download .rtf
                        </button>
                        <button
                          onClick={exportToExcel}
                          className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          Download .xlsx
                        </button>
                      </motion.div>
                    )}

                    {postAnalysisChoice === 'benchmark' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-4 border-t border-zinc-100 space-y-3"
                      >
                        <p className="text-sm text-zinc-600">
                          Upload your benchmark syllabus as an Excel file (.xlsx). The file should follow the same format as the Excel export: <strong>Course Name</strong> in Column A, followed by <strong>Unit 1 Grammar</strong>, <strong>Unit 2 Grammar</strong>, etc.
                        </p>
                        <FileUpload onFilesSelected={handlePostAnalysisBenchmark} mode="excel" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* Benchmark Result */}
              {benchmarkResult && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h3 className="text-2xl font-light tracking-tight">Benchmark Alignment Audit</h3>
                  <div className="bg-white p-8 rounded-3xl border border-amber-200 shadow-sm prose prose-zinc max-w-none">
                    <div className="markdown-body">
                      <Markdown>{benchmarkResult}</Markdown>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center"
          >
            <Loader2 className="w-12 h-12 text-zinc-900 animate-spin mb-4" />
            <p className="text-zinc-900 font-medium animate-pulse">
              {uploadMode === 'fullpdf'
                ? "Analyzing complete coursebook PDF — mapping units, lessons, and grammar..."
                : "Analyzing syllabus data..."}
            </p>
            <p className="text-zinc-500 text-sm mt-2">
              {uploadMode === 'fullpdf' ? "This may take a few minutes for large coursebooks" : "Using Claude AI structural comparison models"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
