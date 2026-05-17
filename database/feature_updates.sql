USE OnlineExamSystem;
GO

/* Same score => same rank (ties by score only) */
IF OBJECT_ID('sp_GenerateRankings', 'P') IS NOT NULL
    DROP PROCEDURE sp_GenerateRankings;
GO

CREATE PROCEDURE sp_GenerateRankings
    @exam_id INT
AS
BEGIN
    SET NOCOUNT ON;

    WITH RankedStudents AS
    (
        SELECT
            result_id,
            DENSE_RANK() OVER (ORDER BY score DESC) AS ranking
        FROM Results
        WHERE exam_id = @exam_id
    )
    UPDATE r
    SET student_rank = rs.ranking
    FROM Results r
    INNER JOIN RankedStudents rs ON r.result_id = rs.result_id;
END;
GO

/* Delete exam and related records in correct order */
IF OBJECT_ID('sp_DeleteExam', 'P') IS NOT NULL
    DROP PROCEDURE sp_DeleteExam;
GO

CREATE PROCEDURE sp_DeleteExam
    @exam_id INT,
    @admin_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM Exams WHERE exam_id = @exam_id)
    BEGIN
        RAISERROR('Exam not found', 16, 1);
        RETURN;
    END

    IF @admin_id IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM Exams WHERE exam_id = @exam_id AND created_by = @admin_id
       )
    BEGIN
        RAISERROR('You can only delete exams you created', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE sa
        FROM StudentAnswers sa
        INNER JOIN ExamAttempts ea ON ea.attempt_id = sa.attempt_id
        WHERE ea.exam_id = @exam_id;

        DELETE FROM Results WHERE exam_id = @exam_id;
        DELETE FROM AuditLogs WHERE exam_id = @exam_id;
        DELETE FROM ExamAttempts WHERE exam_id = @exam_id;
        DELETE FROM Questions WHERE exam_id = @exam_id;
        DELETE FROM Exams WHERE exam_id = @exam_id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

/* Database cleanup: attempts | exams | all (keeps student/admin accounts) */
IF OBJECT_ID('sp_CleanDatabase', 'P') IS NOT NULL
    DROP PROCEDURE sp_CleanDatabase;
GO

CREATE PROCEDURE sp_CleanDatabase
    @mode VARCHAR(20) = 'attempts'
AS
BEGIN
    SET NOCOUNT ON;

    IF @mode NOT IN ('attempts', 'exams', 'all')
    BEGIN
        RAISERROR('mode must be attempts, exams, or all', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE FROM StudentAnswers;
        DELETE FROM Results;
        DELETE FROM AuditLogs;
        DELETE FROM ExamAttempts;

        IF @mode IN ('exams', 'all')
        BEGIN
            DELETE FROM Questions;
            DELETE FROM Exams;
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
