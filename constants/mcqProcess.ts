


export const MCQ_PROCESS_BLUEPRINT = `
####Quy trình nghiên cứu
### Lưu ý tại mỗi nhánh ToT: được phép sử dụng thêm kiến thức trong phần khác trong bài & tài liệu uy tín (về cận lâm sàng và lâm sàng) để nâng cao chất lượng/ độ khó câu hỏi. Các kiến thức phụ này được phép vượt qua quy tắc và sự kiểm định về nội dung của bước 6##

### <Bước 1> Bước 1:  Tại quá trình "AI Tái cấu trúc & Phân tích"
(Đã thực hiện ở giai đoạn Intake của ứng dụng)

###Bước 2: Dựa theo mục lục của bài được tích, tôi sẽ chọn các phần tôi mong muốn bạn thực hiện, và bạn tiến hành chia ra và cho lần lượt 5 API (coccurency) làm cùng một lúc để lần lượt thực hiện để tạo các câu hỏi theo mô hình ToT (tối đa 20 - 25 câu hỏi của một lượt API). Trong mỗi "coccurency", hãy tạo ra các thẻ basic anki có chất lượng tốt

Tri thức để tạo ra các thẻ basic anki sao cho:

##phân bố đủ mức độ dễ - trung bình - khó - rất khó thỏa trọng số mức độ dễ - trung bình - khó - rất khó được theo như tôi yêu cầu ##

###Lưu ý tại mỗi nhánh ToT: mặc dù tôi yêu cầu mỗi API làm câu hỏi về nội dung chính của nhánh đó, nhưng có ngoại lệ được phép sử dụng thêm kiến thức trong phần khác trong bài & tài liệu uy tín (về cận lâm sàng và lâm sàng) để nâng cao chất lượng/ độ khó/ độ phức tạp câu hỏi  ⇒ Cho phép sử dụng thêm các kiến thức: 
- ##Kiến thức của các phần khác trong bài có liên quan để tạo ra câu hỏi phức tạp [kể cả kiến thức không được tích trong checkbox, miễn sao là kiến thức đó có trong tài liệu được tôi gửi]##
- ##Kiến thức nếu không quá quan trọng (chủ yếu dừng ở mức triệu chứng hoặc tối đa là cận lâm sàng) ⇒ Có thể sử dụng nguồn tài liệu ở ngoài (trang web uy tín)##
##Ví dụ một câu hỏi (tôi nghĩ nó ở mức trung bình): Đề mục được yêu cầu là điều trị của Hội chứng vành cấp ST không chênh lên. ... cần kết hợp thêm kiến thức ở các nguồn khác ... (triệu chứng lâm sàng/cận lâm sàng → chẩn đoán → phân tầng nguy cơ → xử trí; có thể thêm nhiễu như bóc tách ĐMC...) ...
- Nguồn tài liệu ... WHO, ADA, AHA/ACC, ESC; NEJM, Lancet, BMJ, Nature, JAMA; Harrison, Guyton, Bates ...
##Lưu ý rằng, sự cho phép sử dụng các kiến thức phụ này được phép vượt qua quy tắc và sự kiểm định về nội dung của bước 6 (Do bước 6 có mô tả là chỉ được sử dụng nguồn từ tài liệu được gửi và không sử dụng nguồn ở ngoài)’##

##Câu hỏi MCQ đạt chất lượng tốt:
#[Tại phần nội dung này, lúc sau tôi sẽ cung cấp riêng tri thức để tránh quá tải nội dung]#

##Có thể tạo ra câu hỏi tình huống lâm sàng liên hoàn ##
#[Tại phần nội dung này, lúc sau tôi sẽ cung cấp riêng tri thức để tránh quá tải nội dung]#

###Bước 3: Trong mỗi câu hỏi của 1 "coccurency",, những thẻ anki basic không bị một trong các vấn đề sau :
- ##Không đạt được điều kiện là một thẻ MCQ có chất lượng tốt##
  #[Tại phần nội dung này, lúc sau tôi sẽ cung cấp riêng tri thức để tránh quá tải nội dung]#
- ##Không đạt được điều kiện là một thẻ MCQ không bị hallucianation##
  #[Tại phần nội dung này, lúc sau tôi sẽ cung cấp riêng tri thức để tránh quá tải nội dung]#
⇒ Được cải thiện thành một thẻ chất lượng tốt hơn (tức là cải thiện lại tiêu chí không đạt trong câu hỏi), vẫn đạt mức độ khó như tôi yêu cầu, và không bị hallucination, trừ trường hợp thẻ đó chắc chắn không thể nào tạo ra nội dung thỏa mãn yêu cầu của tôi thì có thể loại luôn nội dung đó (những phải được tổng hợp và báo cáo lại cho tôi ở bước 6)

###Bước 4: Trong mỗi câu hỏi của 1 "coccurency", những thẻ basic đã thỏa điều kiện chất lượng tốt hoặc đã được cải thiện thành thẻ có chất lượng tốt sẽ có thêm các hint (gợi ý) để trả lời
#[Tại phần nội dung này, lúc sau tôi sẽ cung cấp riêng tri thức để tránh quá tải nội dung]#

###Bước 5: Ở từng thẻ basic của 1 "coccurency", sau khi thực hiện tạo xong thẻ basic, bạn hãy tiến hành. Giải thích tại sao lại lựa chọn đáp án đó một cách đầy đủ

[Quan trọng không được xóa]
##<Trích dẫn nguyên văn nội dung gốc> Đồng thời tiến hành trích dẫn NGUYÊN VĂN CÁC NỘI DUNG GỐC được dùng để trả lời đáp án của câu hỏi đó (nội dung gốc không được sai sót bất cứ chữ hay kí tự, dấu nào so với tài liệu gốc)

#Đối với nội dung nằm ở trong tài liệu tôi cung cấp: Trích dẫn y hệt nội dung trong tài liệu. Đồng thời phải có thêm trích dẫn <Đề mục lớn => đề mục nhỏ chứa nội dung trích dẫn> #

#Đối với nội dung nằm ở ngoài tài liệu tôi cung cấp (NẾU ĐƯỢC PHÉP - Tầng 3):
- **Chỉ sử dụng** cho các chi tiết về **Triệu chứng lâm sàng** hoặc **Cận lâm sàng** mà tài liệu gốc thiếu.
- **NGHIÊM CẤM:** Không được bịa URL, không bịa tên guideline. Nếu không chắc chắn, KHÔNG dùng.
- **YÊU CẦU TRÍCH DẪN:** Trong phần Explanation, phải ghi rõ mục "External references:" bao gồm: Tên tổ chức/tài liệu – Năm – URL – Trích dẫn ngắn.
- **HƯỚNG DẪN CHI TIẾT:** Xem phần phụ lục "MCQ_EXTERNAL_SOURCES_GUIDE_V1" (được cung cấp kèm theo prompt) để biết danh sách nguồn uy tín được phép dùng (WHO, ESC, NEJM...) và cách xử lý.

##<Trích dẫn đề mục> Đồng thời trích dẫn thẻ basic này ở phần nào trong file bài học tôi đã gửi, cụ thể chính xác là trích dẫn đề mục của bài trong <chỉ thị> <phần đề mục được đánh dấu tích>.##
`;