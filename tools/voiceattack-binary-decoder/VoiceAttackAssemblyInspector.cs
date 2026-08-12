using Mono.Cecil;
using Mono.Cecil.Cil;

namespace VoiceAttackBinaryDecoder;

internal static class VoiceAttackAssemblyInspector
{
    private static readonly string[] CommonVoiceAttackDirectories =
    {
        @"C:\Users\morga\HCS\VoiceAttack",
        @"C:\Program Files\VoiceAttack",
        @"C:\Program Files (x86)\VoiceAttack",
    };

    public static VoiceAttackInspectReport Inspect(InspectCommandOptions options)
    {
        var voiceAttackDirectory = ResolveVoiceAttackDirectory(options);
        if (voiceAttackDirectory is null)
        {
            return new VoiceAttackInspectReport
            {
                Ok = false,
                Error = "VoiceAttack installation directory could not be located.",
            };
        }

        var assemblies = Directory.GetFiles(voiceAttackDirectory, "*.dll")
            .Concat(Directory.GetFiles(voiceAttackDirectory, "*.exe"))
            .OrderBy(static path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var report = new VoiceAttackInspectReport
        {
            Ok = true,
            VoiceAttackDirectory = voiceAttackDirectory,
        };

        var resolver = new DefaultAssemblyResolver();
        resolver.AddSearchDirectory(voiceAttackDirectory);
        var readerParameters = new ReaderParameters
        {
            AssemblyResolver = resolver,
            ReadSymbols = false,
            ReadWrite = false,
            InMemory = true,
        };

        foreach (var assemblyPath in assemblies)
        {
            AssemblyDefinition assemblyDefinition;
            try
            {
                assemblyDefinition = AssemblyDefinition.ReadAssembly(assemblyPath, readerParameters);
            }
            catch
            {
                continue;
            }

            using (assemblyDefinition)
            {
                report.Assemblies.Add(new AssemblyReport
                {
                    Name = assemblyDefinition.Name.Name ?? Path.GetFileNameWithoutExtension(assemblyPath),
                    Path = assemblyPath,
                    Version = assemblyDefinition.Name.Version?.ToString() ?? "unknown",
                });

                CollectSerializerReferences(assemblyDefinition, report);
                CollectZeroFormattableTypes(assemblyDefinition, report);
                CollectLoaderMethods(assemblyDefinition, report);
            }
        }

        report.SerializerReferences = report.SerializerReferences
            .OrderBy(static entry => entry.AssemblyName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(static entry => entry.TypeName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        report.ZeroFormattableTypes = report.ZeroFormattableTypes
            .OrderByDescending(static entry => entry.MaxIndex)
            .ThenByDescending(static entry => entry.IndexedMemberCount)
            .ThenBy(static entry => entry.TypeName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        report.LoaderMethods = report.LoaderMethods
            .OrderByDescending(static entry => entry.RootType.Contains("Profile", StringComparison.OrdinalIgnoreCase))
            .ThenBy(static entry => entry.DeclaringType, StringComparer.OrdinalIgnoreCase)
            .ThenBy(static entry => entry.MethodName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        report.PreferredRootType = report.ZeroFormattableTypes
            .FirstOrDefault(static entry => entry.MaxIndex >= 80 && entry.TypeName.Contains("Profile", StringComparison.OrdinalIgnoreCase))
            ?? report.ZeroFormattableTypes.FirstOrDefault(static entry => entry.MaxIndex >= 80);
        report.PreferredLoader = report.LoaderMethods
            .FirstOrDefault(static entry => entry.RootType.Contains("Profile", StringComparison.OrdinalIgnoreCase))
            ?? report.LoaderMethods.FirstOrDefault();

        if (report.Assemblies.Count == 0)
        {
            report.Ok = false;
            report.Error = "No readable VoiceAttack assemblies were found in the located directory.";
        }

        return report;
    }

    private static string? ResolveVoiceAttackDirectory(InspectCommandOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.VoiceAttackDirectory))
        {
            return ValidateVoiceAttackDirectory(options.VoiceAttackDirectory!);
        }

        foreach (var candidate in CommonVoiceAttackDirectories)
        {
            var valid = ValidateVoiceAttackDirectory(candidate);
            if (valid is not null)
            {
                return valid;
            }
        }

        return null;
    }

    private static string? ValidateVoiceAttackDirectory(string candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return null;
        }

        var fullPath = Path.GetFullPath(candidate);
        return File.Exists(Path.Combine(fullPath, "VoiceAttack.exe")) ? fullPath : null;
    }

    private static void CollectSerializerReferences(AssemblyDefinition assemblyDefinition, VoiceAttackInspectReport report)
    {
        foreach (var type in assemblyDefinition.MainModule.GetTypeReferences())
        {
            if (!IsInterestingSerializerReference(type.FullName))
            {
                continue;
            }

            report.SerializerReferences.Add(new SerializerReferenceReport
            {
                AssemblyName = assemblyDefinition.Name.Name ?? assemblyDefinition.MainModule.Name,
                TypeName = type.FullName,
                Evidence = "type_reference",
            });
        }
    }

    private static bool IsInterestingSerializerReference(string fullName)
    {
        return fullName.Contains("ZeroFormatter", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("Utf8Json", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("DeflateStream", StringComparison.OrdinalIgnoreCase)
            || fullName.Contains("BinaryReader", StringComparison.OrdinalIgnoreCase);
    }

    private static void CollectZeroFormattableTypes(AssemblyDefinition assemblyDefinition, VoiceAttackInspectReport report)
    {
        foreach (var type in assemblyDefinition.MainModule.Types)
        {
            CollectZeroFormattableTypesRecursive(type, assemblyDefinition, report);
        }
    }

    private static void CollectZeroFormattableTypesRecursive(
        TypeDefinition type,
        AssemblyDefinition assemblyDefinition,
        VoiceAttackInspectReport report)
    {
        if (HasAttribute(type.CustomAttributes, "ZeroFormattableAttribute"))
        {
            var indexedMembers = new List<IndexedMemberReport>();

            foreach (var property in type.Properties)
            {
                var index = GetIndexValue(property.CustomAttributes);
                if (index.HasValue)
                {
                    indexedMembers.Add(new IndexedMemberReport
                    {
                        Index = index.Value,
                        MemberName = property.Name,
                        MemberType = property.PropertyType.FullName,
                        MemberKind = "property",
                    });
                }
            }

            foreach (var field in type.Fields)
            {
                var index = GetIndexValue(field.CustomAttributes);
                if (index.HasValue)
                {
                    indexedMembers.Add(new IndexedMemberReport
                    {
                        Index = index.Value,
                        MemberName = field.Name,
                        MemberType = field.FieldType.FullName,
                        MemberKind = "field",
                    });
                }
            }

            indexedMembers = indexedMembers
                .OrderBy(static entry => entry.Index)
                .ThenBy(static entry => entry.MemberKind, StringComparer.OrdinalIgnoreCase)
                .ThenBy(static entry => entry.MemberName, StringComparer.OrdinalIgnoreCase)
                .ToList();

            report.ZeroFormattableTypes.Add(new ZeroFormattableTypeReport
            {
                AssemblyName = assemblyDefinition.Name.Name ?? assemblyDefinition.MainModule.Name,
                TypeName = type.FullName,
                IsPublic = type.IsPublic || type.IsNestedPublic,
                IsClass = type.IsClass,
                IndexedMemberCount = indexedMembers.Count,
                MaxIndex = indexedMembers.Count == 0 ? -1 : indexedMembers.Max(static entry => entry.Index),
                IndexedMembers = indexedMembers,
            });
        }

        foreach (var nestedType in type.NestedTypes)
        {
            CollectZeroFormattableTypesRecursive(nestedType, assemblyDefinition, report);
        }
    }

    private static void CollectLoaderMethods(AssemblyDefinition assemblyDefinition, VoiceAttackInspectReport report)
    {
        foreach (var type in assemblyDefinition.MainModule.Types)
        {
            CollectLoaderMethodsRecursive(type, assemblyDefinition, report);
        }
    }

    private static void CollectLoaderMethodsRecursive(
        TypeDefinition type,
        AssemblyDefinition assemblyDefinition,
        VoiceAttackInspectReport report)
    {
        foreach (var method in type.Methods)
        {
            if (!method.HasBody || method.Body.Instructions.Count == 0)
            {
                continue;
            }

            var loader = InspectMethodForLoaderCall(assemblyDefinition, type, method);
            if (loader is not null)
            {
                report.LoaderMethods.Add(loader);
            }
        }

        foreach (var nestedType in type.NestedTypes)
        {
            CollectLoaderMethodsRecursive(nestedType, assemblyDefinition, report);
        }
    }

    private static LoaderMethodReport? InspectMethodForLoaderCall(
        AssemblyDefinition assemblyDefinition,
        TypeDefinition declaringType,
        MethodDefinition method)
    {
        foreach (var instruction in method.Body.Instructions)
        {
            if (instruction.OpCode.Code != Code.Call && instruction.OpCode.Code != Code.Callvirt)
            {
                continue;
            }

            if (instruction.Operand is not MethodReference calledMethod)
            {
                continue;
            }

            var fullName = calledMethod.FullName;
            if (!fullName.Contains("Deserialize", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (!fullName.Contains("ZeroFormatter", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var genericRootType = GetGenericRootTypeName(calledMethod);
            return new LoaderMethodReport
            {
                AssemblyName = assemblyDefinition.Name.Name ?? assemblyDefinition.MainModule.Name,
                DeclaringType = declaringType.FullName,
                MethodName = method.Name,
                ReturnType = method.ReturnType.FullName,
                ParameterTypes = method.Parameters.Select(static parameter => parameter.ParameterType.FullName).ToList(),
                SerializerMethod = calledMethod.FullName,
                RootType = genericRootType ?? "unknown",
                Evidence = BuildLoaderEvidence(method),
            };
        }

        return null;
    }

    private static string? GetGenericRootTypeName(MethodReference calledMethod)
    {
        if (calledMethod is GenericInstanceMethod genericInstanceMethod && genericInstanceMethod.GenericArguments.Count > 0)
        {
            return genericInstanceMethod.GenericArguments[0].FullName;
        }

        return null;
    }

    private static List<string> BuildLoaderEvidence(MethodDefinition method)
    {
        var evidence = new List<string>();
        foreach (var instruction in method.Body.Instructions)
        {
            if (instruction.Operand is MethodReference methodReference)
            {
                if (methodReference.FullName.Contains("DeflateStream", StringComparison.OrdinalIgnoreCase))
                {
                    evidence.Add($"calls {methodReference.FullName}");
                }
                if (methodReference.FullName.Contains("Deserialize", StringComparison.OrdinalIgnoreCase))
                {
                    evidence.Add($"calls {methodReference.FullName}");
                }
            }

            if (instruction.Operand is TypeReference typeReference
                && typeReference.FullName.Contains("DeflateStream", StringComparison.OrdinalIgnoreCase))
            {
                evidence.Add($"references {typeReference.FullName}");
            }
        }

        return evidence.Distinct(StringComparer.Ordinal).ToList();
    }

    private static bool HasAttribute(IEnumerable<CustomAttribute> attributes, string attributeName)
    {
        return attributes.Any((attribute) => string.Equals(attribute.AttributeType.Name, attributeName, StringComparison.Ordinal));
    }

    private static int? GetIndexValue(IEnumerable<CustomAttribute> attributes)
    {
        var indexAttribute = attributes.FirstOrDefault((attribute) => string.Equals(
            attribute.AttributeType.Name,
            "IndexAttribute",
            StringComparison.Ordinal));
        if (indexAttribute is null || indexAttribute.ConstructorArguments.Count == 0)
        {
            return null;
        }

        var value = indexAttribute.ConstructorArguments[0].Value;
        return value is int index ? index : null;
    }
}
