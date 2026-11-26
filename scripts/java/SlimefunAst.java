import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.tools.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.io.*;

// Syntax only: never loads or executes Slimefun/Bukkit classes or processors.
// Java source-file mode requires a JDK (17+). All outputs use CREATE_NEW.
public class SlimefunAst {
    static Map<String,Object> obj(Object... values) {
        Map<String,Object> result = new LinkedHashMap<>();
        for (int i=0;i<values.length;i+=2) result.put((String)values[i], values[i+1]);
        return result;
    }
    static Object expr(Tree tree) {
        if (tree == null) return null;
        if (tree instanceof LiteralTree t) return obj("kind","literal","value",t.getValue(),"literalType",t.getKind().name());
        if (tree instanceof IdentifierTree || tree instanceof MemberSelectTree)
            return obj("kind","ref","name",tree.toString());
        if (tree instanceof ParenthesizedTree t) return expr(t.getExpression());
        if (tree instanceof TypeCastTree t) return obj("kind","cast","type",t.getType().toString(),"value",expr(t.getExpression()));
        if (tree instanceof NewClassTree t) return obj("kind","new","type",t.getIdentifier().toString(),
            "args",t.getArguments().stream().map(SlimefunAst::expr).toList(),"anonymous",t.getClassBody()!=null);
        if (tree instanceof NewArrayTree t) return obj("kind","array","type",String.valueOf(t.getType()),
            "values",t.getInitializers()==null?null:t.getInitializers().stream().map(SlimefunAst::expr).toList(),
            "dimensions",t.getDimensions().stream().map(SlimefunAst::expr).toList());
        if (tree instanceof MethodInvocationTree t) {
            Tree select=t.getMethodSelect();
            Object receiver=null;
            String name=select.toString();
            if (select instanceof MemberSelectTree s) { receiver=expr(s.getExpression()); name=s.getIdentifier().toString(); }
            return obj("kind","call","name",name,"receiver",receiver,
                "args",t.getArguments().stream().map(SlimefunAst::expr).toList());
        }
        if (tree instanceof BinaryTree t) return obj("kind","binary","operator",t.getKind().name(),"left",expr(t.getLeftOperand()),"right",expr(t.getRightOperand()));
        if (tree instanceof AssignmentTree t) return obj("kind","assignment","target",t.getVariable().toString(),"value",expr(t.getExpression()));
        return obj("kind","unsupported","syntax",tree.getKind().name(),"raw",tree.toString());
    }
    static List<Object> preRegisterBody(MethodTree method) {
        List<Object> body=new ArrayList<>();
        for (StatementTree stmt:method.getBody().getStatements()) {
            body.add(stmt instanceof ExpressionStatementTree e ? expr(e.getExpression()) : obj("kind","unsupported"));
        }
        return body;
    }
    static boolean deferredHandler(MethodTree method) {
        if (method.getBody().getStatements().size()!=1 ||
            !(method.getBody().getStatements().get(0) instanceof ReturnTree result)) return false;
        Tree value=result.getExpression();
        if (value instanceof LambdaExpressionTree) return true;
        if (value instanceof MemberReferenceTree) return value.toString().equals("PlayerRightClickEvent::cancel");
        if (!(value instanceof NewClassTree n) || n.getEnclosingExpression()!=null ||
            !n.getIdentifier().toString().equals("BlockPlaceHandler") || n.getClassBody()==null ||
            n.getArguments().size()!=1 || !(n.getArguments().get(0) instanceof LiteralTree flag) ||
            !Boolean.FALSE.equals(flag.getValue())) return false;
        var members=n.getClassBody().getMembers();
        return members.size()==1 && members.get(0) instanceof MethodTree m &&
            m.getName().contentEquals("onPlayerPlace") && m.getParameters().size()==1 &&
            m.getParameters().get(0).getType().toString().equals("BlockPlaceEvent");
    }
    static String json(Object value) {
        if(value==null) return "null";
        if(value instanceof Number || value instanceof Boolean) return value.toString();
        if(value instanceof Map<?,?> map) {
            List<String> parts=new ArrayList<>();
            map.forEach((k,v)->parts.add(json(k.toString())+":"+json(v)));
            return "{"+String.join(",",parts)+"}";
        }
        if(value instanceof Iterable<?> list) {
            List<String> parts=new ArrayList<>(); for(Object v:list) parts.add(json(v));
            return "["+String.join(",",parts)+"]";
        }
        StringBuilder result=new StringBuilder("\"");
        for(char c:value.toString().toCharArray()) {
            switch(c) {
                case '"' -> result.append("\\\""); case '\\' -> result.append("\\\\");
                case '\n' -> result.append("\\n"); case '\r' -> result.append("\\r"); case '\t' -> result.append("\\t");
                default -> { if(c<32) result.append(String.format("\\u%04x",(int)c)); else result.append(c); }
            }
        }
        return result.append('"').toString();
    }
    public static void main(String[] args) throws Exception {
        if(args.length!=2) throw new IllegalArgumentException("Usage: java SlimefunAst.java <source-root> <fresh-output.json>");
        Path root=Path.of(args[0]).toRealPath(), output=Path.of(args[1]).toAbsolutePath();
        if(Files.exists(output)) throw new IOException("Output already exists: "+output);
        JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
        if(compiler==null) throw new IllegalStateException("A JDK is required, not a JRE");
        List<Path> paths;
        try(var walk=Files.walk(root)) {
            paths=walk.filter(p->p.toString().endsWith(".java") && Files.isRegularFile(p) && !Files.isSymbolicLink(p)).sorted().toList();
        }
        if(paths.isEmpty()) throw new IOException("No Java sources found");
        var diagnostics=new DiagnosticCollector<JavaFileObject>();
        List<Object> classes=new ArrayList<>(), registrations=new ArrayList<>(), errors=new ArrayList<>();
        try(StandardJavaFileManager manager=compiler.getStandardFileManager(diagnostics,Locale.ROOT,StandardCharsets.UTF_8)) {
            JavacTask task=(JavacTask)compiler.getTask(null,manager,diagnostics,List.of("-proc:none"),null,
                manager.getJavaFileObjectsFromPaths(paths));
            var units=task.parse();
            var positions=Trees.instance(task).getSourcePositions();
            for(CompilationUnitTree unit:units) {
                String file=root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\','/');
                new TreePathScanner<Void,Void>() {
                    Map<String,Object> location(Tree tree) {
                        long pos=positions.getStartPosition(unit,tree);
                        return obj("file",file,"line",pos<0?null:unit.getLineMap().getLineNumber(pos));
                    }
                    public Void visitClass(ClassTree tree,Void unused) {
                        if(tree.getSimpleName().length()==0) return super.visitClass(tree,unused);
                        List<Object> fields=new ArrayList<>(), constructors=new ArrayList<>(), recipeOverrides=new ArrayList<>();
                        Map<String,Object> handlerMethods=new LinkedHashMap<>();
                        for(Tree member:tree.getMembers()) {
                            if(member instanceof VariableTree v) fields.add(obj("name",v.getName().toString(),"type",String.valueOf(v.getType()),
                                "modifiers",v.getModifiers().getFlags().toString(),"value",expr(v.getInitializer()),"source",location(v)));
                            if(member instanceof MethodTree m && m.getReturnType()==null) {
                                List<Object> body=new ArrayList<>();
                                if(m.getBody()!=null) for(StatementTree statement:m.getBody().getStatements()) {
                                    body.add(statement instanceof ExpressionStatementTree e ? expr(e.getExpression()) :
                                        obj("kind","unsupported","syntax",statement.getKind().name(),"raw",statement.toString()));
                                }
                                constructors.add(obj("params",m.getParameters().stream().map(v->obj("name",v.getName().toString(),"type",v.getType().toString(),
                                        "varargs",v.toString().contains("..."))).toList(),
                                    "body",body,"source",location(m)));
                            }
                            if(member instanceof MethodTree m && m.getReturnType()!=null &&
                                List.of("getRecipeOutput","getRecipeType","getRecipe","getId","register","registerRecipe","load",
                                    "preRegister","postRegister").contains(m.getName().toString())) recipeOverrides.add(m.getName().toString());
                            if(member instanceof MethodTree m && m.getBody()!=null && m.getParameters().isEmpty()) {
                                String name=m.getName().toString();
                                if(name.equals("preRegister")) handlerMethods.put(name,obj("body",preRegisterBody(m),"source",location(m)));
                                if(name.equals("getItemHandler") || name.equals("onShoot"))
                                    handlerMethods.put(name,obj("type",m.getReturnType().toString(),"deferred",deferredHandler(m),"source",location(m)));
                            }
                        }
                        classes.add(obj("name",tree.getSimpleName().toString(),"package",String.valueOf(unit.getPackageName()),
                            "extends",String.valueOf(tree.getExtendsClause()),"fields",fields,"constructors",constructors,
                            "recipeOverrides",recipeOverrides,"handlerMethods",handlerMethods,"source",location(tree)));
                        return super.visitClass(tree,unused);
                    }
                    public Void visitMethodInvocation(MethodInvocationTree tree,Void unused) {
                        if(tree.getMethodSelect() instanceof MemberSelectTree s && s.getIdentifier().contentEquals("register")) {
                            List<String> contexts=new ArrayList<>();
                            String owner=null, method=null;
                            for(TreePath p=getCurrentPath().getParentPath();p!=null;p=p.getParentPath()) {
                                switch(p.getLeaf().getKind()) {
                                    case IF, FOR_LOOP, ENHANCED_FOR_LOOP, WHILE_LOOP, DO_WHILE_LOOP, SWITCH, SWITCH_EXPRESSION, LAMBDA_EXPRESSION -> contexts.add(p.getLeaf().getKind().name());
                                    default -> {}
                                }
                                if(owner==null && p.getLeaf() instanceof ClassTree c) owner=c.getSimpleName().toString();
                                if(method==null && p.getLeaf() instanceof MethodTree m) method=m.getName().toString();
                            }
                            registrations.add(obj("expression",expr(s.getExpression()),"source",location(tree),"contexts",contexts,
                                "owner",owner,"method",method,"arguments",tree.getArguments().stream().map(SlimefunAst::expr).toList()));
                        }
                        return super.visitMethodInvocation(tree,unused);
                    }
                }.scan(unit,null);
            }
        }
        for(var d:diagnostics.getDiagnostics()) if(d.getKind()==Diagnostic.Kind.ERROR)
            errors.add(obj("status","ERROR","file",d.getSource()==null?null:root.relativize(Path.of(d.getSource().toUri())).toString().replace('\\','/'),
                "line",d.getLineNumber(),"message",d.getMessage(Locale.ROOT)));
        var result=obj("schema","OB-SF Java AST V1","files",paths.size(),"classes",classes,"registrations",registrations,"diagnostics",errors);
        Files.createDirectories(output.getParent());
        try(var writer=Files.newBufferedWriter(output,StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW)) { writer.write(json(result)); }
        System.out.println("Java AST: files="+paths.size()+", registrations="+registrations.size()+", syntaxErrors="+errors.size()+", output="+output);
        if(!errors.isEmpty()) System.exit(2);
    }
}
