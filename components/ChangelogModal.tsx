import React from 'react';
import { XIcon } from './Icons';

interface Change {
  type: 'NEW' | 'IMPROVEMENT' | 'FIX';
  description: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  changes: Change[];
}

export const changelogData: ChangelogEntry[] = [
  {
    version: 'v1.7',
    date: '2024-08-01',
    changes: [
      { type: 'FIX', description: 'Cập nhật đường dẫn import và cú pháp gọi API Gemini để tương thích với thư viện @google/genai mới nhất, giải quyết lỗi TypeError.' },
      { type: 'FIX', description: 'Sửa lỗi hiển thị phiên bản trên header. Header giờ sẽ tự động lấy phiên bản mới nhất từ dữ liệu changelog thay vì bị hardcode.' },
    ],
  },
  {
    version: 'v1.6',
    date: '2024-07-31',
    changes: [
      { type: 'NEW', description: 'Thêm ô nhập "Bối cảnh bổ sung" (Extra Context) dành riêng cho "Cloze Phân Biệt" khi ở Chế độ Độc quyền, cho phép AI tạo thẻ so sánh từ các phần văn bản khác nhau.' },
      { type: 'NEW', description: 'Bổ sung nút "Sao chép Hướng dẫn" trong Cố vấn AI để biến các khuyến nghị về "Cloze Phân Biệt" thành chỉ thị tùy chỉnh một cách nhanh chóng.' },
      { type: 'IMPROVEMENT', description: 'Nâng cấp mạnh mẽ Cố vấn AI với module "Săn tìm Cặp dễ nhầm lẫn" (Confusion Set Hunter), giúp đề xuất thẻ "Cloze Phân Biệt" chính xác và giá trị hơn.' },
      { type: 'IMPROVEMENT', description: 'Cải thiện khả năng hiển thị văn bản có cấu trúc (danh sách, tiêu đề) trong các thẻ Anki, giúp nội dung gốc và ngữ cảnh dễ đọc hơn.' },
      { type: 'FIX', description: 'Sửa lỗi nghiêm trọng khiến "Chế độ Độc quyền" không được tuân thủ, hệ thống tự động chuyển về chế độ AUTO và tạo ra các loại thẻ ngoài lựa chọn của người dùng.' },
    ],
  },
  {
    version: 'v1.5',
    date: '2024-07-30',
    changes: [
      { type: 'IMPROVEMENT', description: 'Cập nhật và đồng bộ hóa Lịch sử cập nhật (Changelog) để phản ánh các tính năng mới nhất.' },
      { type: 'FIX', description: 'Sửa lỗi phiên bản hiển thị trên header bị lỗi thời (hardcoded) và không tự động cập nhật.' },
    ],
  },
  {
    version: 'v1.4',
    date: '2024-07-30',
    changes: [
      { type: 'IMPROVEMENT', description: 'Nâng cấp "Ưu tiên dạng thẻ" thành "Chế độ Độc quyền (Exclusive Mode)", cho phép người dùng chỉ định chính xác các loại thẻ cần tạo.' },
    ],
  },
  {
    version: 'v1.3',
    date: '2024-07-30',
    changes: [
      { type: 'NEW', description: 'Thêm "Cloze Cơ bản" (basic) vào danh sách các loại thẻ, cho phép tập trung tạo các thẻ nguyên tử, tối giản.' },
    ],
  },
  {
    version: 'v1.2',
    date: '2024-07-29',
    changes: [
      { type: 'NEW', description: 'Thêm tính năng xem Lịch sử Ôn tập chi tiết cho từng chủ đề trong phần Luyện thi Tự luận.' },
      { type: 'IMPROVEMENT', description: 'Cải thiện giao diện bảng tiến độ để truy cập lịch sử dễ dàng hơn.' },
    ],
  },
  {
    version: 'v1.1',
    date: '2024-07-28',
    changes: [
      { type: 'NEW', description: 'Thêm cửa sổ "Lịch sử cập nhật" để người dùng có thể theo dõi các thay đổi của ứng dụng.' },
      { type: 'IMPROVEMENT', description: 'Cải thiện giao diện người dùng và tính nhất quán trong bảng Luyện thi Tự luận.' },
      { type: 'FIX', description: 'Sửa lỗi nhỏ liên quan đến việc sao chép văn bản trên một số trình duyệt.' },
    ],
  },
  {
    version: 'v1.0',
    date: '2024-07-25',
    changes: [
      { type: 'NEW', description: 'Phát hành phiên bản đầu tiên của AI Medical Anki Cloze Generator.' },
      { type: 'NEW', description: 'Các tính năng cốt lõi: Tạo thẻ Anki Cloze, Ôn tập Lặp lại ngắt quãng, và Luyện thi Tự luận.' },
    ],
  },
];

const typeStyles = {
    NEW: 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200',
    IMPROVEMENT: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200',
    FIX: 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200',
};

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex justify-center items-center p-4 transition-opacity duration-300 animate-fadeIn"
      aria-modal="true"
      role="dialog"
    >
      <div 
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'fadeIn 0.3s ease-out, scaleIn 0.3s ease-out' }}
      >
        <div className="flex justify-between items-center p-5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Lịch sử cập nhật</h2>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="Đóng"
          >
            <XIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-8">
          {changelogData.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-baseline space-x-3">
                <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{entry.version}</span>
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{entry.date}</span>
              </div>
              <ul className="mt-4 space-y-3 list-none">
                {entry.changes.map((change, index) => (
                  <li key={index} className="flex items-start space-x-3">
                    <span className={`flex-shrink-0 mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${typeStyles[change.type]}`}>
                      {change.type}
                    </span>
                    <p className="text-slate-700 dark:text-slate-300">{change.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
         <div className="p-4 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
           <button onClick={onClose}>Đóng</button>
         </div>
      </div>
       <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes scaleIn {
            from { transform: scale(0.95); }
            to { transform: scale(1); }
          }
          .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
          .animate-scaleIn { animation: scaleIn 0.2s ease-out forwards; }
       `}</style>
    </div>
  );
};