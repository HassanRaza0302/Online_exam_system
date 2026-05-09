USE OnlineExamSystem;
GO

IF COL_LENGTH('Students', 'status') IS NULL
BEGIN
    ALTER TABLE Students
    ADD status VARCHAR(20) NOT NULL CONSTRAINT DF_Students_Status DEFAULT 'APPROVED';
END
GO

IF COL_LENGTH('Students', 'approved_by') IS NULL
BEGIN
    ALTER TABLE Students
    ADD approved_by INT NULL;
END
GO

IF COL_LENGTH('Students', 'approved_at') IS NULL
BEGIN
    ALTER TABLE Students
    ADD approved_at DATETIME NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Students_Status'
)
BEGIN
    ALTER TABLE Students
    ADD CONSTRAINT CK_Students_Status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Students_ApprovedBy_Admins'
)
BEGIN
    ALTER TABLE Students
    ADD CONSTRAINT FK_Students_ApprovedBy_Admins
    FOREIGN KEY (approved_by) REFERENCES Admins(admin_id);
END
GO

IF COL_LENGTH('Admins', 'status') IS NULL
BEGIN
    ALTER TABLE Admins
    ADD status VARCHAR(20) NOT NULL CONSTRAINT DF_Admins_Status DEFAULT 'APPROVED';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Admins_Status'
)
BEGIN
    ALTER TABLE Admins
    ADD CONSTRAINT CK_Admins_Status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
END
GO

UPDATE Students
SET status = 'APPROVED'
WHERE status IS NULL;
GO

UPDATE Admins
SET status = 'APPROVED'
WHERE status IS NULL;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_students_status'
      AND object_id = OBJECT_ID('Students')
)
BEGIN
    CREATE INDEX idx_students_status ON Students(status);
END
GO

