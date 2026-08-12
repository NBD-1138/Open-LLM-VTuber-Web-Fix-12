using System.IO.Compression;
using System.Reflection;

namespace VoiceAttackBinaryDecoder;

internal static class VoiceAttackBinaryProfileDecoder
{
    private static readonly object SyncRoot = new();

    private static readonly HashSet<string> ResolvingAssemblyNames = new(StringComparer.OrdinalIgnoreCase);

    private static string? _voiceAttackDirectory;

    private static bool _resolverRegistered;

    public static VoiceAttackDecodeReport Decode(DecodeCommandOptions options)
    {
        var inspectOptions = InspectCommandOptions.Parse(BuildInspectArgs(options));
        var inspectReport = VoiceAttackAssemblyInspector.Inspect(inspectOptions);
        if (!inspectReport.Ok || string.IsNullOrWhiteSpace(inspectReport.VoiceAttackDirectory))
        {
            return new VoiceAttackDecodeReport
            {
                Ok = false,
                Error = inspectReport.Error ?? "VoiceAttack inspection failed before decode.",
                PayloadFormat = null,
                VoiceAttackDirectory = inspectReport.VoiceAttackDirectory,
            };
        }

        var voiceAttackDirectory = inspectReport.VoiceAttackDirectory!;
        var payloadBytes = ReadPayloadBytes(options, out var payloadFormat);
        EnsureResolver(voiceAttackDirectory);

        var voiceAttackAssembly = Assembly.LoadFrom(Path.Combine(voiceAttackDirectory, "VoiceAttack.exe"));
        var profileType = voiceAttackAssembly.GetType("VoiceAttack.Profile2", throwOnError: true);
        var commandType = voiceAttackAssembly.GetType("VoiceAttack.Command2", throwOnError: true);
        var actionType = voiceAttackAssembly.GetType("VoiceAttack.CommandAction2", throwOnError: true);
        var zeroFormatterAssembly = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault((assembly) => string.Equals(assembly.GetName().Name, "ZeroFormatter", StringComparison.OrdinalIgnoreCase))
            ?? Assembly.Load("ZeroFormatter");
        var serializerType = zeroFormatterAssembly.GetType("ZeroFormatter.ZeroFormatterSerializer", throwOnError: true);

        var deserializeMethod = serializerType.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .First((method) => method.Name == "Deserialize"
                && method.IsGenericMethodDefinition
                && method.GetParameters().Length == 1
                && method.GetParameters()[0].ParameterType == typeof(byte[]));
        try
        {
            var maximumLengthProperty = serializerType.GetProperty(
                "MaximumLengthOfDeserialize",
                BindingFlags.Public | BindingFlags.Static);
            maximumLengthProperty?.SetValue(null, 64 * 1024 * 1024);
            var closedDeserialize = deserializeMethod.MakeGenericMethod(profileType);
            var deserializedProfile = closedDeserialize.Invoke(null, new object[] { payloadBytes });
            if (deserializedProfile is null)
            {
                return new VoiceAttackDecodeReport
                {
                    Ok = false,
                    Error = "VoiceAttack returned a null profile during binary decode.",
                    PayloadFormat = payloadFormat,
                    VoiceAttackDirectory = voiceAttackDirectory,
                    RootType = profileType.FullName,
                    CommandType = commandType.FullName,
                    ActionType = actionType.FullName,
                    SerializerMethod = closedDeserialize.ToString(),
                };
            }

            var profile = BuildNeutralProfile(deserializedProfile, inspectReport.PreferredRootType);
            return new VoiceAttackDecodeReport
            {
                Ok = true,
                PayloadFormat = payloadFormat,
                VoiceAttackDirectory = voiceAttackDirectory,
                RootType = profileType.FullName,
                CommandType = commandType.FullName,
                ActionType = actionType.FullName,
                SerializerMethod = closedDeserialize.ToString(),
                Profile = profile,
            };
        }
        catch (Exception exception)
        {
            var rootException = exception;
            while (rootException.InnerException is not null)
            {
                rootException = rootException.InnerException;
            }

            return new VoiceAttackDecodeReport
            {
                Ok = false,
                Error = exception.Message,
                PayloadFormat = payloadFormat,
                VoiceAttackDirectory = voiceAttackDirectory,
                RootType = profileType.FullName,
                CommandType = commandType.FullName,
                ActionType = actionType.FullName,
                SerializerMethod = deserializeMethod.MakeGenericMethod(profileType).ToString(),
                Exception = exception.GetType().FullName,
                RootError = rootException.Message,
                RootException = rootException.GetType().FullName,
            };
        }
    }

    private static IReadOnlyList<string> BuildInspectArgs(DecodeCommandOptions options)
    {
        return string.IsNullOrWhiteSpace(options.VoiceAttackDirectory)
            ? Array.Empty<string>()
            : new[] { "--voiceattack-dir", options.VoiceAttackDirectory! };
    }

    private static byte[] ReadPayloadBytes(DecodeCommandOptions options, out string payloadFormat)
    {
        byte[] payloadBytes;
        if (options.ReadStdin)
        {
            using var stream = Console.OpenStandardInput();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            payloadBytes = memory.ToArray();
        }
        else
        {
            payloadBytes = File.ReadAllBytes(Path.GetFullPath(options.InputFile!));
        }

        if (LooksLikeProfileEnvelope(payloadBytes))
        {
            payloadFormat = "binary_inflated_profile2";
            return payloadBytes;
        }

        if (TryInflateRawPayload(payloadBytes, out var inflatedPayload) && LooksLikeProfileEnvelope(inflatedPayload))
        {
            payloadFormat = "binary_deflate_profile2";
            return inflatedPayload;
        }

        payloadFormat = "unknown";
        return payloadBytes;
    }

    private static bool TryInflateRawPayload(byte[] payloadBytes, out byte[] inflatedPayload)
    {
        try
        {
            using var input = new MemoryStream(payloadBytes, writable: false);
            using var deflate = new DeflateStream(input, CompressionMode.Decompress, leaveOpen: false);
            using var output = new MemoryStream();
            deflate.CopyTo(output);
            inflatedPayload = output.ToArray();
            return inflatedPayload.Length > 0;
        }
        catch
        {
            inflatedPayload = Array.Empty<byte>();
            return false;
        }
    }

    private static bool LooksLikeProfileEnvelope(byte[] payloadBytes)
    {
        if (payloadBytes.Length < 8)
        {
            return false;
        }

        var declaredLength = BitConverter.ToInt32(payloadBytes, 0);
        var lastPropertyIndex = BitConverter.ToInt32(payloadBytes, 4);
        if (declaredLength != payloadBytes.Length || lastPropertyIndex < 0 || lastPropertyIndex > 512)
        {
            return false;
        }

        var offsetTableLength = checked((lastPropertyIndex + 1) * sizeof(int));
        return payloadBytes.Length >= 8 + offsetTableLength;
    }

    private static void EnsureResolver(string voiceAttackDirectory)
    {
        lock (SyncRoot)
        {
            _voiceAttackDirectory = voiceAttackDirectory;
            if (_resolverRegistered)
            {
                return;
            }

            AppDomain.CurrentDomain.AssemblyResolve += ResolveVoiceAttackAssembly;
            _resolverRegistered = true;
        }
    }

    private static Assembly? ResolveVoiceAttackAssembly(object sender, ResolveEventArgs args)
    {
        var assemblyName = new AssemblyName(args.Name).Name;
        if (string.IsNullOrWhiteSpace(assemblyName) || string.IsNullOrWhiteSpace(_voiceAttackDirectory))
        {
            return null;
        }

        lock (SyncRoot)
        {
            if (!ResolvingAssemblyNames.Add(assemblyName))
            {
                return null;
            }
        }

        try
        {
            var dllPath = Path.Combine(_voiceAttackDirectory, assemblyName + ".dll");
            if (File.Exists(dllPath))
            {
                return Assembly.LoadFrom(dllPath);
            }

            var exePath = Path.Combine(_voiceAttackDirectory, assemblyName + ".exe");
            return File.Exists(exePath) ? Assembly.LoadFrom(exePath) : null;
        }
        finally
        {
            lock (SyncRoot)
            {
                ResolvingAssemblyNames.Remove(assemblyName);
            }
        }
    }

    private static NeutralVoiceAttackProfile BuildNeutralProfile(object profileObject, ZeroFormattableTypeReport? rootTypeReport)
    {
        var commands = GetListValues(GetMemberValue(profileObject, "Commands"));
        var neutralCommands = commands
            .Select((commandObject) => BuildNeutralCommand(commandObject))
            .ToList();

        return new NeutralVoiceAttackProfile
        {
            ProfileId = FormatGuidLike(GetMemberValue(profileObject, "Id")),
            InternalId = FormatNullableGuidLike(GetMemberValue(profileObject, "InternalID")),
            Name = GetStringValue(profileObject, "Name") ?? string.Empty,
            ExportVersion = GetStringValue(profileObject, "ExportVAVersion"),
            DefaultTts = GetStringValue(profileObject, "DefaultTTS"),
            Deleted = GetBooleanValue(profileObject, "Deleted"),
            BlockExternal = GetBooleanValue(profileObject, "BlockExternal"),
            DisableAdvancedTts = GetBooleanValue(profileObject, "DisableAdvancedTTS"),
            ExcludeGlobalProfiles = GetBooleanValue(profileObject, "ExcludeGlobalProfiles"),
            UseProcessOverride = GetBooleanValue(profileObject, "UseProcessOverride"),
            ProcessOverride = GetStringValue(profileObject, "ProcessOverride"),
            ProcessOverrideActiveWindow = GetBooleanValue(profileObject, "ProcessOverrideAciveWindow"),
            EnableProfileSwitch = GetBooleanValue(profileObject, "EnableProfileSwitch"),
            ProfileSwitchCriteria = GetStringValue(profileObject, "ProfileSwitchCriteria"),
            CommandCount = neutralCommands.Count,
            ActionCount = neutralCommands.Sum((command) => command.Actions.Count),
            Commands = neutralCommands,
            UnknownFields = BuildUnknownFields(
                profileObject,
                rootTypeReport,
                new HashSet<string>(StringComparer.Ordinal)
                {
                    "Id",
                    "InternalID",
                    "Name",
                    "ExportVAVersion",
                    "DefaultTTS",
                    "Deleted",
                    "BlockExternal",
                    "DisableAdvancedTTS",
                    "ExcludeGlobalProfiles",
                    "UseProcessOverride",
                    "ProcessOverride",
                    "ProcessOverrideAciveWindow",
                    "EnableProfileSwitch",
                    "ProfileSwitchCriteria",
                    "Commands",
                }),
        };
    }

    private static NeutralVoiceAttackCommand BuildNeutralCommand(object commandObject)
    {
        var actions = GetListValues(GetMemberValue(commandObject, "ActionSequence"))
            .Select((actionObject) => BuildNeutralAction(actionObject))
            .ToList();

        return new NeutralVoiceAttackCommand
        {
            CommandId = FormatGuidLike(GetMemberValue(commandObject, "Id")),
            InternalId = FormatNullableGuidLike(GetMemberValue(commandObject, "InternalId")),
            CommandString = GetStringValue(commandObject, "CommandString") ?? string.Empty,
            Label = GetStringValue(commandObject, "Name"),
            Description = GetStringValue(commandObject, "Description"),
            Category = GetStringValue(commandObject, "Category"),
            Enabled = GetBooleanValue(commandObject, "Enabled"),
            Async = GetBooleanValue(commandObject, "Async"),
            UseSpokenPhrase = GetNullableBooleanValue(commandObject, "UseSpokenPhrase"),
            UseShortcut = GetBooleanValue(commandObject, "UseShortcut"),
            RepeatNumber = GetInt32Value(commandObject, "RepeatNumber"),
            RepeatType = GetInt32Value(commandObject, "RepeatType"),
            CommandType = GetInt32Value(commandObject, "CommandType"),
            OnlyKeyUp = GetBooleanValue(commandObject, "onlyKeyUp"),
            UseMouse = GetBooleanValue(commandObject, "UseMouse"),
            UseJoystick = GetBooleanValue(commandObject, "UseJoystick"),
            UseVariableHotkey = GetBooleanValue(commandObject, "UseVariableHotkey"),
            VariableHotkey = GetStringValue(commandObject, "VariableHotkey"),
            UseVariableMouseShortcut = GetBooleanValue(commandObject, "UseVariableMouseShortcut"),
            VariableMouseShortcut = GetStringValue(commandObject, "VariableMouseShortcut"),
            UseVariableJoystickShortcut = GetBooleanValue(commandObject, "UseVariableJoystickShortcut"),
            VariableJoystickShortcut = GetStringValue(commandObject, "VariableJoystickShortcut"),
            UseProcessOverride = GetBooleanValue(commandObject, "UseProcessOverride"),
            ProcessOverride = GetStringValue(commandObject, "ProcessOverride"),
            ProcessOverrideActiveWindow = GetBooleanValue(commandObject, "ProcessOverrideActiveWindow"),
            Actions = actions,
            UnknownFields = BuildUnknownFields(
                commandObject,
                null,
                new HashSet<string>(StringComparer.Ordinal)
                {
                    "Id",
                    "InternalId",
                    "CommandString",
                    "Name",
                    "Description",
                    "Category",
                    "Enabled",
                    "Async",
                    "UseSpokenPhrase",
                    "UseShortcut",
                    "RepeatNumber",
                    "RepeatType",
                    "CommandType",
                    "onlyKeyUp",
                    "UseMouse",
                    "UseJoystick",
                    "UseVariableHotkey",
                    "VariableHotkey",
                    "UseVariableMouseShortcut",
                    "VariableMouseShortcut",
                    "UseVariableJoystickShortcut",
                    "VariableJoystickShortcut",
                    "UseProcessOverride",
                    "ProcessOverride",
                    "ProcessOverrideActiveWindow",
                    "ActionSequence",
                }),
        };
    }

    private static NeutralVoiceAttackAction BuildNeutralAction(object actionObject)
    {
        var randomSounds = GetListValues(GetMemberValue(actionObject, "RandomSounds"))
            .Select((soundObject) => new NeutralVoiceAttackSoundReference
            {
                SoundId = FormatGuidLike(GetMemberValue(soundObject, "Id")),
                Location = GetStringValue(soundObject, "Location"),
                Volume = GetInt32Value(soundObject, "Volume"),
                Complete = GetBooleanValue(soundObject, "Complete"),
                Wait = GetBooleanValue(soundObject, "Wait"),
                Pan = GetSingleValue(soundObject, "Pan"),
                Channel = FormatGuidLike(GetMemberValue(soundObject, "Channel")),
            })
            .ToList();

        var conditionExpressions = new List<List<NeutralVoiceAttackCondition>>();
        foreach (var groupObject in GetListValues(GetMemberValue(actionObject, "ConditionExpressions")))
        {
            var conditions = GetListValues(groupObject)
                .Select((conditionObject) => new NeutralVoiceAttackCondition
                {
                    ConditionId = FormatGuidLike(GetMemberValue(conditionObject, "Id")),
                    ConditionStartType = GetInt32Value(conditionObject, "ConditionStartType"),
                    ConditionStartNameFrom = GetStringValue(conditionObject, "ConditionStartNameFrom"),
                    ConditionStartValueType = GetInt32Value(conditionObject, "ConditionStartValueType"),
                    ConditionStartValue = GetInt32Value(conditionObject, "ConditionStartValue"),
                    ConditionStartCompareToCondition = GetStringValue(conditionObject, "ConditionStartCompareToCondtion"),
                    Z = GetInt32Value(conditionObject, "Z"),
                    ConditionStartOperator = GetInt32Value(conditionObject, "ConditionStartOperator"),
                    Context2 = GetStringValue(conditionObject, "Context2"),
                    DateContext1 = GetDateTimeValue(conditionObject, "DateContext1"),
                    DecimalContext1 = GetDecimalValue(conditionObject, "DecimalContext1"),
                })
                .ToList();
            conditionExpressions.Add(conditions);
        }

        var actionTypeValue = GetMemberValue(actionObject, "ActionType");
        return new NeutralVoiceAttackAction
        {
            ActionId = FormatGuidLike(GetMemberValue(actionObject, "Id")),
            ActionTypeName = FormatEnumOrValue(actionTypeValue),
            ActionTypeValue = ConvertToInt32(actionTypeValue),
            DelaySeconds = GetDoubleValue(actionObject, "Delay"),
            DurationSeconds = GetDoubleValue(actionObject, "Duration"),
            KeyCodes = GetListValues(GetMemberValue(actionObject, "KeyCodes"))
                .Select(static value => Convert.ToUInt16(value))
                .ToArray(),
            Context = GetStringValue(actionObject, "Context"),
            Context2 = GetStringValue(actionObject, "Context2"),
            Context3 = GetStringValue(actionObject, "Context3"),
            Context4 = GetStringValue(actionObject, "Context4"),
            Context5 = GetStringValue(actionObject, "Context5"),
            X = GetInt32Value(actionObject, "X"),
            Y = GetInt32Value(actionObject, "Y"),
            Z = GetInt32Value(actionObject, "Z"),
            InputMode = GetInt32Value(actionObject, "InputMode"),
            ConditionSetName = GetStringValue(actionObject, "ConditionSetName"),
            ConditionSetCondition = GetStringValue(actionObject, "ConditionSetCondition"),
            ConditionPairing = GetInt32Value(actionObject, "ConditionPairing"),
            ConditionGroup = GetInt32Value(actionObject, "ConditionGroup"),
            ConditionStartNameFrom = GetStringValue(actionObject, "ConditionStartNameFrom"),
            ConditionStartOperator = GetInt32Value(actionObject, "ConditionStartOperator"),
            ConditionStartValue = GetInt32Value(actionObject, "ConditionStartValue"),
            ConditionStartValueType = GetInt32Value(actionObject, "ConditionStartValueType"),
            ConditionStartCompareToCondition = GetStringValue(actionObject, "ConditionStartCompareToCondtion"),
            ConditionStartType = GetInt32Value(actionObject, "ConditionStartType"),
            DecimalContext1 = GetDecimalValue(actionObject, "DecimalContext1"),
            DecimalContext2 = GetDecimalValue(actionObject, "DecimalContext2"),
            DateContext1 = GetDateTimeValue(actionObject, "DateContext1"),
            DateContext2 = GetDateTimeValue(actionObject, "DateContext2"),
            Disabled = GetBooleanValue(actionObject, "Disabled"),
            IntegerContext1 = GetInt32Value(actionObject, "IntegerContext1"),
            IntegerContext2 = GetInt32Value(actionObject, "IntegerContext2"),
            RandomSounds = randomSounds,
            ConditionExpressions = conditionExpressions,
            UnknownFields = BuildUnknownFields(
                actionObject,
                null,
                new HashSet<string>(StringComparer.Ordinal)
                {
                    "Id",
                    "ActionType",
                    "Delay",
                    "Duration",
                    "KeyCodes",
                    "Context",
                    "Context2",
                    "Context3",
                    "Context4",
                    "Context5",
                    "X",
                    "Y",
                    "Z",
                    "InputMode",
                    "ConditionSetName",
                    "ConditionSetCondition",
                    "ConditionPairing",
                    "ConditionGroup",
                    "ConditionStartNameFrom",
                    "ConditionStartOperator",
                    "ConditionStartValue",
                    "ConditionStartValueType",
                    "ConditionStartCompareToCondtion",
                    "ConditionStartType",
                    "DecimalContext1",
                    "DecimalContext2",
                    "DateContext1",
                    "DateContext2",
                    "Disabled",
                    "RandomSounds",
                    "ConditionExpressions",
                    "IntegerContext1",
                    "IntegerContext2",
                }),
        };
    }

    private static List<NeutralUnknownField> BuildUnknownFields(
        object source,
        ZeroFormattableTypeReport? typeReport,
        ISet<string> knownMembers)
    {
        var indexLookup = typeReport?.IndexedMembers.ToDictionary(
            static member => member.MemberName,
            static member => (int?)member.Index,
            StringComparer.Ordinal);

        var fields = new List<NeutralUnknownField>();
        foreach (var property in source.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (knownMembers.Contains(property.Name))
            {
                continue;
            }
            fields.Add(new NeutralUnknownField
            {
                Index = indexLookup is not null && indexLookup.TryGetValue(property.Name, out var propertyIndex) ? propertyIndex : null,
                Name = property.Name,
                ValueType = property.PropertyType.FullName ?? property.PropertyType.Name,
                ValueText = FormatUnknownValue(property.GetValue(source, null)),
            });
        }

        foreach (var field in source.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            if (knownMembers.Contains(field.Name))
            {
                continue;
            }
            fields.Add(new NeutralUnknownField
            {
                Index = indexLookup is not null && indexLookup.TryGetValue(field.Name, out var fieldIndex) ? fieldIndex : null,
                Name = field.Name,
                ValueType = field.FieldType.FullName ?? field.FieldType.Name,
                ValueText = FormatUnknownValue(field.GetValue(source)),
            });
        }

        return fields
            .OrderBy((entry) => entry.Index ?? int.MaxValue)
            .ThenBy((entry) => entry.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string? FormatUnknownValue(object? value)
    {
        if (value is null)
        {
            return null;
        }
        if (value is string stringValue)
        {
            return stringValue;
        }
        if (value is Guid guidValue)
        {
            return guidValue.ToString("D");
        }
        if (value is Enum enumValue)
        {
            return $"{enumValue} ({Convert.ToInt32(enumValue)})";
        }
        if (value is IEnumerable<object> objectEnumerable)
        {
            return $"collection[{objectEnumerable.Count()}]";
        }
        if (value is System.Collections.IEnumerable enumerable && value.GetType() != typeof(byte[]))
        {
            var count = 0;
            foreach (var _ in enumerable)
            {
                count += 1;
            }
            return $"collection[{count}]";
        }
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
    }

    private static IReadOnlyList<object> GetListValues(object? value)
    {
        if (value is null)
        {
            return Array.Empty<object>();
        }
        if (value is string)
        {
            return Array.Empty<object>();
        }
        if (value is System.Collections.IEnumerable enumerable)
        {
            var items = new List<object>();
            foreach (var item in enumerable)
            {
                if (item is not null)
                {
                    items.Add(item);
                }
            }
            return items;
        }
        return Array.Empty<object>();
    }

    private static object? GetMemberValue(object source, string memberName)
    {
        var property = source.GetType().GetProperty(memberName, BindingFlags.Public | BindingFlags.Instance);
        if (property is not null)
        {
            return property.GetValue(source, null);
        }
        var field = source.GetType().GetField(memberName, BindingFlags.Public | BindingFlags.Instance);
        return field?.GetValue(source);
    }

    private static string? GetStringValue(object source, string memberName)
        => GetMemberValue(source, memberName) as string;

    private static bool GetBooleanValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        return value is bool flag && flag;
    }

    private static bool? GetNullableBooleanValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        return value is bool flag ? flag : value as bool?;
    }

    private static int GetInt32Value(object source, string memberName)
        => ConvertToInt32(GetMemberValue(source, memberName));

    private static int ConvertToInt32(object? value)
    {
        if (value is null)
        {
            return 0;
        }
        try
        {
            return Convert.ToInt32(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static double GetDoubleValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        if (value is null)
        {
            return 0;
        }
        try
        {
            return Convert.ToDouble(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static float GetSingleValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        if (value is null)
        {
            return 0;
        }
        try
        {
            return Convert.ToSingle(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static decimal GetDecimalValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        if (value is null)
        {
            return 0;
        }
        try
        {
            return Convert.ToDecimal(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch
        {
            return 0;
        }
    }

    private static DateTime GetDateTimeValue(object source, string memberName)
    {
        var value = GetMemberValue(source, memberName);
        return value is DateTime dateTime ? dateTime : default;
    }

    private static string FormatGuidLike(object? value)
    {
        if (value is Guid guidValue)
        {
            return guidValue.ToString("D");
        }
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
    }

    private static string? FormatNullableGuidLike(object? value)
    {
        if (value is null)
        {
            return null;
        }
        if (value is Guid guidValue)
        {
            return guidValue.ToString("D");
        }
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string FormatEnumOrValue(object? value)
    {
        if (value is Enum enumValue)
        {
            return enumValue.ToString();
        }
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
    }
}
