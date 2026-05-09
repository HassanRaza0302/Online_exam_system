USE OnlineExamSystem;
GO

IF OBJECT_ID('sp_StudentLogin', 'P') IS NOT NULL
    DROP PROCEDURE sp_StudentLogin;
GO

CREATE PROCEDURE sp_StudentLogin
    @email VARCHAR(100),
    @password_hash VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
        student_id,
        full_name,
        email
    FROM Students
    WHERE email = @email
      AND password = @password_hash;
END;
GO

IF OBJECT_ID('sp_AdminLogin', 'P') IS NOT NULL
    DROP PROCEDURE sp_AdminLogin;
GO

CREATE PROCEDURE sp_AdminLogin
    @email VARCHAR(100),
    @password_hash VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
        admin_id,
        full_name,
        email
    FROM Admins
    WHERE email = @email
      AND password = @password_hash;
END;
GO

IF OBJECT_ID('sp_LogAuthEvent', 'P') IS NOT NULL
    DROP PROCEDURE sp_LogAuthEvent;
GO

CREATE PROCEDURE sp_LogAuthEvent
    @event_type VARCHAR(100),
    @event_description VARCHAR(500),
    @student_id INT = NULL,
    @exam_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO AuditLogs (student_id, exam_id, event_type, event_description)
    VALUES (@student_id, @exam_id, @event_type, @event_description);
END;
GO

