namespace VoiceAttackBinaryDecoder;

internal sealed class VoiceAttackDecodeReport
{
    public bool Ok { get; set; }

    public string? Error { get; set; }

    public string? PayloadFormat { get; set; }

    public string? VoiceAttackDirectory { get; set; }

    public string? RootType { get; set; }

    public string? CommandType { get; set; }

    public string? ActionType { get; set; }

    public string? SerializerMethod { get; set; }

    public string? Exception { get; set; }

    public string? RootError { get; set; }

    public string? RootException { get; set; }

    public NeutralVoiceAttackProfile? Profile { get; set; }
}

internal sealed class NeutralVoiceAttackProfile
{
    public string Type { get; set; } = "profile";

    public string ProfileId { get; set; } = string.Empty;

    public string? InternalId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? ExportVersion { get; set; }

    public string? DefaultTts { get; set; }

    public bool Deleted { get; set; }

    public bool BlockExternal { get; set; }

    public bool DisableAdvancedTts { get; set; }

    public bool ExcludeGlobalProfiles { get; set; }

    public bool UseProcessOverride { get; set; }

    public string? ProcessOverride { get; set; }

    public bool ProcessOverrideActiveWindow { get; set; }

    public bool EnableProfileSwitch { get; set; }

    public string? ProfileSwitchCriteria { get; set; }

    public int CommandCount { get; set; }

    public int ActionCount { get; set; }

    public List<NeutralVoiceAttackCommand> Commands { get; set; } = new();

    public List<NeutralUnknownField> UnknownFields { get; set; } = new();
}

internal sealed class NeutralVoiceAttackCommand
{
    public string Type { get; set; } = "command";

    public string CommandId { get; set; } = string.Empty;

    public string? InternalId { get; set; }

    public string CommandString { get; set; } = string.Empty;

    public string? Label { get; set; }

    public string? Description { get; set; }

    public string? Category { get; set; }

    public bool Enabled { get; set; }

    public bool Async { get; set; }

    public bool? UseSpokenPhrase { get; set; }

    public bool UseShortcut { get; set; }

    public int RepeatNumber { get; set; }

    public int RepeatType { get; set; }

    public int CommandType { get; set; }

    public bool OnlyKeyUp { get; set; }

    public bool UseMouse { get; set; }

    public bool UseJoystick { get; set; }

    public bool UseVariableHotkey { get; set; }

    public string? VariableHotkey { get; set; }

    public bool UseVariableMouseShortcut { get; set; }

    public string? VariableMouseShortcut { get; set; }

    public bool UseVariableJoystickShortcut { get; set; }

    public string? VariableJoystickShortcut { get; set; }

    public bool UseProcessOverride { get; set; }

    public string? ProcessOverride { get; set; }

    public bool ProcessOverrideActiveWindow { get; set; }

    public List<NeutralVoiceAttackAction> Actions { get; set; } = new();

    public List<NeutralUnknownField> UnknownFields { get; set; } = new();
}

internal sealed class NeutralVoiceAttackAction
{
    public string Type { get; set; } = "action";

    public string ActionId { get; set; } = string.Empty;

    public string ActionTypeName { get; set; } = string.Empty;

    public int ActionTypeValue { get; set; }

    public double DelaySeconds { get; set; }

    public double DurationSeconds { get; set; }

    public ushort[] KeyCodes { get; set; } = Array.Empty<ushort>();

    public string? Context { get; set; }

    public string? Context2 { get; set; }

    public string? Context3 { get; set; }

    public string? Context4 { get; set; }

    public string? Context5 { get; set; }

    public int X { get; set; }

    public int Y { get; set; }

    public int Z { get; set; }

    public int InputMode { get; set; }

    public string? ConditionSetName { get; set; }

    public string? ConditionSetCondition { get; set; }

    public int ConditionPairing { get; set; }

    public int ConditionGroup { get; set; }

    public string? ConditionStartNameFrom { get; set; }

    public int ConditionStartOperator { get; set; }

    public int ConditionStartValue { get; set; }

    public int ConditionStartValueType { get; set; }

    public string? ConditionStartCompareToCondition { get; set; }

    public int ConditionStartType { get; set; }

    public decimal DecimalContext1 { get; set; }

    public decimal DecimalContext2 { get; set; }

    public DateTime DateContext1 { get; set; }

    public DateTime DateContext2 { get; set; }

    public bool Disabled { get; set; }

    public int IntegerContext1 { get; set; }

    public int IntegerContext2 { get; set; }

    public List<NeutralVoiceAttackSoundReference> RandomSounds { get; set; } = new();

    public List<List<NeutralVoiceAttackCondition>> ConditionExpressions { get; set; } = new();

    public List<NeutralUnknownField> UnknownFields { get; set; } = new();
}

internal sealed class NeutralVoiceAttackSoundReference
{
    public string SoundId { get; set; } = string.Empty;

    public string? Location { get; set; }

    public int Volume { get; set; }

    public bool Complete { get; set; }

    public bool Wait { get; set; }

    public float Pan { get; set; }

    public string? Channel { get; set; }
}

internal sealed class NeutralVoiceAttackCondition
{
    public string ConditionId { get; set; } = string.Empty;

    public int ConditionStartType { get; set; }

    public string? ConditionStartNameFrom { get; set; }

    public int ConditionStartValueType { get; set; }

    public int ConditionStartValue { get; set; }

    public string? ConditionStartCompareToCondition { get; set; }

    public int Z { get; set; }

    public int ConditionStartOperator { get; set; }

    public string? Context2 { get; set; }

    public DateTime DateContext1 { get; set; }

    public decimal DecimalContext1 { get; set; }
}

internal sealed class NeutralUnknownField
{
    public int? Index { get; set; }

    public string Name { get; set; } = string.Empty;

    public string ValueType { get; set; } = string.Empty;

    public string? ValueText { get; set; }
}
