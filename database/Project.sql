IF DB_ID('OnlineExamSystem') IS NULL
BEGIN
    CREATE DATABASE OnlineExamSystem;
END
GO

USE OnlineExamSystem;
GO

/* =========================
   STUDENTS TABLE
========================= */

CREATE TABLE Students (
    student_id INT PRIMARY KEY IDENTITY(1,1),
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT GETDATE()
);


/* =========================
   ADMINS TABLE
========================= */

CREATE TABLE Admins (
    admin_id INT PRIMARY KEY IDENTITY(1,1),
    full_name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password VARCHAR(100)
);


/* =========================
   EXAMS TABLE
========================= */

CREATE TABLE Exams (
    exam_id INT PRIMARY KEY IDENTITY(1,1),
    exam_title VARCHAR(200) NOT NULL,
    subject_name VARCHAR(100),
    duration_minutes INT NOT NULL,
    total_marks INT,
    created_by INT,
    created_at DATETIME DEFAULT GETDATE(),

    FOREIGN KEY (created_by)
    REFERENCES Admins(admin_id)
);


/* =========================
   QUESTIONS TABLE
========================= */

CREATE TABLE Questions (
    question_id INT PRIMARY KEY IDENTITY(1,1),
    exam_id INT NOT NULL,

    question_text VARCHAR(1000) NOT NULL,

    option_a VARCHAR(300) NOT NULL,
    option_b VARCHAR(300) NOT NULL,
    option_c VARCHAR(300) NOT NULL,
    option_d VARCHAR(300) NOT NULL,

    correct_option CHAR(1) CHECK (correct_option IN ('A','B','C','D')),

    marks INT DEFAULT 5,

    FOREIGN KEY (exam_id)
    REFERENCES Exams(exam_id)
    ON DELETE CASCADE
);


/* =========================
   EXAM ATTEMPTS TABLE
========================= */

CREATE TABLE ExamAttempts (
    attempt_id INT PRIMARY KEY IDENTITY(1,1),

    student_id INT NOT NULL,
    exam_id INT NOT NULL,

    start_time DATETIME DEFAULT GETDATE(),
    end_time DATETIME NULL,

    status VARCHAR(20) DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'SUBMITTED')),

    FOREIGN KEY (student_id)
    REFERENCES Students(student_id),

    FOREIGN KEY (exam_id)
    REFERENCES Exams(exam_id)
);


/* =========================
   STUDENT ANSWERS TABLE
========================= */

CREATE TABLE StudentAnswers (
    answer_id INT PRIMARY KEY IDENTITY(1,1),

    attempt_id INT NOT NULL,
    question_id INT NOT NULL,

    selected_option CHAR(1)
    CHECK (selected_option IN ('A','B','C','D')),

    FOREIGN KEY (attempt_id)
    REFERENCES ExamAttempts(attempt_id)
    ON DELETE CASCADE,

    FOREIGN KEY (question_id)
    REFERENCES Questions(question_id)
);


/* =========================
   RESULTS TABLE
========================= */

CREATE TABLE Results (
    result_id INT PRIMARY KEY IDENTITY(1,1),

    attempt_id INT UNIQUE NOT NULL,

    student_id INT NOT NULL,
    exam_id INT NOT NULL,

    score INT DEFAULT 0,

    percentage DECIMAL(5,2),

    student_rank INT NULL,

    submitted_at DATETIME DEFAULT GETDATE(),

    FOREIGN KEY (attempt_id)
    REFERENCES ExamAttempts(attempt_id),

    FOREIGN KEY (student_id)
    REFERENCES Students(student_id),

    FOREIGN KEY (exam_id)
    REFERENCES Exams(exam_id)
);


/* =========================
   AUDIT LOGS TABLE
========================= */

CREATE TABLE AuditLogs (
    log_id INT PRIMARY KEY IDENTITY(1,1),

    student_id INT,
    exam_id INT,

    event_type VARCHAR(100),

    event_description VARCHAR(500),

    log_time DATETIME DEFAULT GETDATE()
);


/* =========================
   INDEXES FOR PERFORMANCE
========================= */

CREATE INDEX idx_student_email
ON Students(email);

CREATE INDEX idx_exam_title
ON Exams(exam_title);

CREATE INDEX idx_question_exam
ON Questions(exam_id);

CREATE INDEX idx_attempt_student
ON ExamAttempts(student_id);

CREATE INDEX idx_result_rank
ON Results(student_rank);


/* =========================
   SAMPLE ADMINS
========================= */

INSERT INTO Admins(full_name, email, password)
VALUES
('Admin User', 'admin@exam.com', 'admin123');


/* =========================
   SAMPLE STUDENTS
========================= */

INSERT INTO Students(full_name, email, password)
VALUES
('Ali Khan', 'ali@gmail.com', '123'),

('Ahmed Raza', 'ahmed@gmail.com', '123'),

('Sara Noor', 'sara@gmail.com', '123'),

('Fatima Hassan', 'fatima@gmail.com', '123');


/* =========================
   SAMPLE EXAM
========================= */

INSERT INTO Exams
(exam_title, subject_name, duration_minutes, total_marks, created_by)
VALUES
('DBMS Midterm Examination', 'Database Systems', 30, 20, 1);


/* =========================
   SAMPLE QUESTIONS
========================= */

INSERT INTO Questions
(exam_id, question_text,
option_a, option_b, option_c, option_d,
correct_option, marks)

VALUES

(
1,
'What does DBMS stand for?',
'Database Management System',
'Digital Base Management System',
'Data Backup Management System',
'Dynamic Management Base System',
'A',
5
),

(
1,
'Which SQL command is used to retrieve data?',
'INSERT',
'UPDATE',
'SELECT',
'DELETE',
'C',
5
),

(
1,
'Which property ensures transaction reliability?',
'ACID',
'JOIN',
'UNION',
'VIEW',
'A',
5
),

(
1,
'Which key uniquely identifies a record?',
'Foreign Key',
'Primary Key',
'Candidate Key',
'Composite Key',
'B',
5
);


/* =========================
   VIEW FOR TOP STUDENTS
========================= */

GO

CREATE VIEW vw_TopStudents
AS
SELECT
    s.full_name,
    e.exam_title,
    r.score,
    r.percentage,
    r.student_rank
FROM Results r
JOIN Students s
ON r.student_id = s.student_id
JOIN Exams e
ON r.exam_id = e.exam_id;


/* =========================
   STORED PROCEDURE:
   SUBMIT EXAM
========================= */

GO

CREATE PROCEDURE sp_SubmitExam
    @attempt_id INT
AS
BEGIN

    BEGIN TRY

        BEGIN TRANSACTION;

        DECLARE @student_id INT;
        DECLARE @exam_id INT;
        DECLARE @score INT;
        DECLARE @total_marks INT;

        SELECT
            @student_id = student_id,
            @exam_id = exam_id
        FROM ExamAttempts
        WHERE attempt_id = @attempt_id;

        SELECT
            @score = ISNULL(SUM(q.marks),0)
        FROM StudentAnswers sa
        JOIN Questions q
        ON sa.question_id = q.question_id
        WHERE sa.attempt_id = @attempt_id
        AND sa.selected_option = q.correct_option;

        SELECT
            @total_marks = total_marks
        FROM Exams
        WHERE exam_id = @exam_id;

        INSERT INTO Results
        (
            attempt_id,
            student_id,
            exam_id,
            score,
            percentage
        )
        VALUES
        (
            @attempt_id,
            @student_id,
            @exam_id,
            @score,
            (@score * 100.0 / @total_marks)
        );

        UPDATE ExamAttempts
        SET
            status = 'SUBMITTED',
            end_time = GETDATE()
        WHERE attempt_id = @attempt_id;

        COMMIT TRANSACTION;

    END TRY

    BEGIN CATCH

        ROLLBACK TRANSACTION;

        PRINT 'Transaction Failed';

    END CATCH

END;

GO


/* =========================
   STORED PROCEDURE:
   GENERATE RANKINGS
========================= */

CREATE PROCEDURE sp_GenerateRankings
    @exam_id INT
AS
BEGIN

    WITH RankedStudents AS
    (
        SELECT
            result_id,
            DENSE_RANK() OVER (ORDER BY score DESC) AS ranking
        FROM Results
        WHERE exam_id = @exam_id
    )

    UPDATE Results
    SET student_rank = RankedStudents.ranking
    FROM Results
    JOIN RankedStudents
    ON Results.result_id = RankedStudents.result_id;

END;

GO


/* =========================
   TRIGGER:
   AUDIT LOG AFTER SUBMISSION
========================= */

CREATE TRIGGER trg_AuditExamSubmission
ON Results
AFTER INSERT
AS
BEGIN

    INSERT INTO AuditLogs
    (
        student_id,
        exam_id,
        event_type,
        event_description
    )

    SELECT
        student_id,
        exam_id,
        'EXAM_SUBMITTED',
        'Student submitted exam successfully'
    FROM inserted;

END;

GO
